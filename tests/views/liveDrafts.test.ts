import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => hoisted.repo }));

import { LiveDraftPillView } from '@/components/shell/LiveDraftPill';
import type { Repo } from '@/lib/db/repo';
import { defaultScoring } from '@/lib/scoring/config';
import { loadMyLiveDrafts, safeLiveDrafts, type MyLiveDraft } from '@/lib/views/liveDrafts';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let seq = 0;
beforeEach(() => {
  repo = createMemoryRepo();
  hoisted.repo = repo;
});

async function seedLeague(slug: string, name: string, userId: string, others: string[] = []) {
  const league = await repo.createLeague({ slug, name, defaultScoring: defaultScoring() });
  const me = await repo.createMember({ leagueId: league.id, userId, name: `Me ${slug}`, role: 'player' });
  const rest = [];
  for (const [i, n] of others.entries()) rest.push(await repo.createMember({ leagueId: league.id, userId: `u-${slug}-${i}`, name: n, role: 'player' }));
  return { league, me, rest };
}

async function seedRound(leagueId: string, draftOrder: string[], opts: { mode?: 'live' | 'commissioner'; start?: boolean; pause?: boolean } = {}) {
  const round = await repo.createRound({
    leagueId, eventKey: `2026test${seq++}`, eventName: 'Test Event', startDate: '2026-10-24', endDate: '2026-10-24',
    timezone: 'America/New_York', scoring: defaultScoring(), rosterSize: 1, draftOrder,
  });
  await repo.updateRound(round.id, { draftMode: opts.mode ?? 'live' });
  if (opts.start ?? true) await repo.draftControl(round.id, 'start');
  if (opts.pause) await repo.draftControl(round.id, 'pause');
  return round;
}

describe('loadMyLiveDrafts', () => {
  it('a started live draft with no picks: live, my turn when I am first', async () => {
    const { league, me, rest } = await seedLeague('fam', 'Family', 'u1', ['Bo']);
    const round = await seedRound(league.id, [me.id, rest[0].id]);
    expect(await loadMyLiveDrafts('u1')).toEqual([
      { leagueSlug: 'fam', leagueName: 'Family', roundId: round.id, eventName: 'Test Event', phase: 'live', myTurn: true },
    ]);
  });

  it('not my turn when someone else is first', async () => {
    const { league, me, rest } = await seedLeague('fam', 'Family', 'u1', ['Bo']);
    await seedRound(league.id, [rest[0].id, me.id]);
    expect((await loadMyLiveDrafts('u1'))[0].myTurn).toBe(false);
  });

  it('a paused draft is paused and never my turn', async () => {
    const { league, me } = await seedLeague('fam', 'Family', 'u1');
    await seedRound(league.id, [me.id], { pause: true });
    const [d] = await loadMyLiveDrafts('u1');
    expect(d.phase).toBe('paused');
    expect(d.myTurn).toBe(false);
  });

  it('ignores commissioner drafts, not-started drafts and finished drafts', async () => {
    const { league, me } = await seedLeague('fam', 'Family', 'u1');
    await seedRound(league.id, [me.id], { mode: 'commissioner', start: false });
    await seedRound(league.id, [me.id], { start: false });
    const done = await seedRound(league.id, [me.id]);
    await repo.insertPick({ roundId: done.id, pickNumber: 0, playerId: me.id, teamKey: 'frc1' }); // 1 pick x roster 1 = full
    expect(await loadMyLiveDrafts('u1')).toEqual([]);
  });

  it('sorts my-turn drafts first, then by league name', async () => {
    const a = await seedLeague('aaa', 'Alpha', 'u1', ['Bo']);
    await seedRound(a.league.id, [a.rest[0].id, a.me.id]);
    const z = await seedLeague('zzz', 'Zulu', 'u1');
    await seedRound(z.league.id, [z.me.id]);
    expect((await loadMyLiveDrafts('u1')).map((d) => d.leagueName)).toEqual(['Zulu', 'Alpha']);
  });

  it('a user in no leagues gets []', async () => {
    expect(await loadMyLiveDrafts('nobody')).toEqual([]);
  });
});

describe('safeLiveDrafts', () => {
  it('fails closed to [] when the database throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    hoisted.repo = { listLeaguesForUser: async () => { throw new Error('db asleep'); } };
    expect(await safeLiveDrafts('u1')).toEqual([]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('LiveDraftPillView', () => {
  const d = (over: Partial<MyLiveDraft> = {}): MyLiveDraft => ({
    leagueSlug: 'fam', leagueName: 'Family', roundId: 'r1', eventName: 'Ramp Riot', phase: 'live', myTurn: false, ...over,
  });
  const render = (drafts: MyLiveDraft[], pathname: string) => renderToStaticMarkup(h(LiveDraftPillView, { drafts, pathname }));

  it('renders nothing with no drafts', () => expect(render([], '/')).toBe(''));
  it('links to the draft room', () => {
    const html = render([d()], '/');
    expect(html).toContain('Draft is live');
    expect(html).toContain('Family');
    expect(html).toContain('href="/l/fam/r/r1/draft"');
  });
  it('says Your pick! on my turn', () => expect(render([d({ myTurn: true })], '/')).toContain('Your pick!'));
  it('says paused when paused', () => expect(render([d({ phase: 'paused' })], '/')).toContain('Draft paused'));
  it('steps aside on the draft room', () => expect(render([d()], '/l/fam/r/1/draft')).toBe(''));
  it('shows +1 for a second draft', () => expect(render([d(), d({ roundId: 'r2', leagueName: 'Other' })], '/')).toContain('+1'));
});
