import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import type { Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { syncFollowedEvents } from '@/lib/follow/sync';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

const NOW = new Date('2026-10-10T14:00:00.000Z');
let repo: Repo;
let league: LeagueRow;

const ev = (key: string, event_type: number, start: string, end = start) => ({
  key, name: `Event ${key}`, event_type, start_date: start, end_date: end,
});

/** TBA: team events by path, plus /event/{key} for the timezone. Anything else is "no data". */
function tba(byTeam: Record<number, unknown[]>, opts: { failTeam?: number } = {}) {
  h.getTba = vi.fn(async (path: unknown) => {
    const p = String(path);
    const team = /^\/team\/frc(\d+)\/events\/2026\/simple$/.exec(p);
    if (team) {
      if (Number(team[1]) === opts.failTeam) return { data: null, fetchedAt: null, stale: true };
      return { data: byTeam[Number(team[1])] ?? [], fetchedAt: NOW.toISOString(), stale: false };
    }
    const event = /^\/event\/(\w+)$/.exec(p);
    if (event) return { data: { key: event[1], timezone: 'America/Chicago' }, fetchedAt: NOW.toISOString(), stale: false };
    return { data: null, fetchedAt: null, stale: false };
  });
}

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  ({ league } = await seedLeague(repo));
  await repo.setFollows(league.id, [5181]);
});

describe('syncFollowedEvents', () => {
  it('creates auto-added TBA rounds with the league scoring and default roster 4', async () => {
    tba({ 5181: [ev('2026parr', 99, '2026-10-24'), ev('2026week0', 100, '2026-10-20')] });
    const out = await syncFollowedEvents(league, NOW);
    expect(out.ok).toBe(true);
    const rounds = await repo.listRounds(league.id);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({
      kind: 'tba', eventKey: '2026parr', eventName: 'Event 2026parr', startDate: '2026-10-24',
      timezone: 'America/Chicago', autoAdded: true, rosterSize: 4, draftOrder: [],
      draftMode: 'commissioner', pickSeconds: null, draftStartedAt: null,
    });
    expect(rounds[0].scoring).toEqual(DEFAULT_SCORING);
    expect((await repo.getLeagueBySlug(league.slug))!.followsSyncedAt).toBe(NOW.toISOString());
  });

  it('copies roster size and the linked players of the most recently created round', async () => {
    const mom = await repo.createMember({ leagueId: league.id, userId: crypto.randomUUID(), name: 'Mom', role: 'player' });
    const gone = await repo.createMember({ leagueId: league.id, userId: crypto.randomUUID(), name: 'Gone', role: 'player' });
    await repo.updatePlayer(gone.id, { userId: null });
    const base = { eventName: 'x', timezone: 'America/New_York', scoring: DEFAULT_SCORING };
    const older = await repo.createRound({ leagueId: league.id, eventKey: '2026old', startDate: '2026-12-01', endDate: '2026-12-01', ...base });
    await repo.updateRound(older.id, { rosterSize: 2 });
    const newer = await repo.createRound({ leagueId: league.id, eventKey: '2026new', startDate: '2026-09-01', endDate: '2026-09-01', ...base });
    await repo.updateRound(newer.id, { rosterSize: 6, draftOrder: [gone.id, mom.id] });
    tba({ 5181: [ev('2026parr', 99, '2026-10-24')] });
    await syncFollowedEvents(league, NOW);
    const added = (await repo.listRounds(league.id)).find((r) => r.eventKey === '2026parr')!;
    expect(added).toMatchObject({ rosterSize: 6, draftOrder: [mom.id] });
  });

  it('never re-adds a skipped event (Review Focus 1)', async () => {
    await repo.addSkippedEvent(league.id, '2026parr');
    tba({ 5181: [ev('2026parr', 99, '2026-10-24')] });
    await syncFollowedEvents(league, NOW);
    expect(await repo.listRounds(league.id)).toEqual([]);
  });

  it('on a TBA failure creates nothing and leaves followsSyncedAt alone', async () => {
    await repo.setFollows(league.id, [5181, 341]);
    tba({ 5181: [ev('2026parr', 99, '2026-10-24')] }, { failTeam: 341 });
    const out = await syncFollowedEvents(league, NOW);
    expect(out).toEqual({ ok: false, added: [] });
    expect(await repo.listRounds(league.id)).toEqual([]);
    expect((await repo.getLeagueBySlug(league.slug))!.followsSyncedAt).toBeNull();
  });

  it('two syncs at once make each round once (Review Focus 2)', async () => {
    await repo.setFollows(league.id, [5181, 341]);
    tba({ 5181: [ev('2026parr', 99, '2026-10-24')], 341: [ev('2026parr', 99, '2026-10-24'), ev('2026mrcmp', 2, '2026-10-30')] });
    const [a, b] = await Promise.all([syncFollowedEvents(league, NOW), syncFollowedEvents(league, NOW)]);
    expect(a.added.length + b.added.length).toBe(2);
    expect((await repo.listRounds(league.id)).map((r) => r.eventKey).sort()).toEqual(['2026mrcmp', '2026parr']);
  });

  it('does nothing for a season league', async () => {
    const season = await seedLeague(repo, { slug: 'season-fam-abc234', format: 'season' });
    await repo.setFollows(season.league.id, [5181]);
    tba({ 5181: [ev('2026parr', 99, '2026-10-24')] });
    expect(await syncFollowedEvents(season.league, NOW)).toEqual({ ok: true, added: [] });
    expect(h.getTba).not.toHaveBeenCalled();
  });

  it('with no follows, marks the league synced without calling TBA', async () => {
    await repo.setFollows(league.id, []);
    tba({});
    expect(await syncFollowedEvents(league, NOW)).toEqual({ ok: true, added: [] });
    expect(h.getTba).not.toHaveBeenCalled();
    expect((await repo.getLeagueBySlug(league.slug))!.followsSyncedAt).toBe(NOW.toISOString());
  });
});
