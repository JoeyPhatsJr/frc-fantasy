import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown, getTba: vi.fn() }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...a: unknown[]) => h.getTba(...a) }));

import type { Repo } from '@/lib/db/repo';
import { defaultScoring } from '@/lib/scoring/config';
import { loadHome } from '@/lib/views/home';
import { createMemoryRepo } from '../helpers/memoryRepo';

describe('loadHome', () => {
  let repo: Repo;
  beforeEach(() => {
    repo = createMemoryRepo();
    h.repo = repo;
    h.getTba.mockResolvedValue({ data: null, fetchedAt: null, stale: false });
  });

  it('with no leagues: nothing to show and a zero season', async () => {
    await repo.createProfile({ id: 'u1', displayName: 'Joey', avatarUrl: null });
    const page = await loadHome('u1', new Date('2026-10-01T12:00:00Z'));
    expect(page.leagues).toEqual([]);
    expect(page.upNext).toBeNull();
    expect(page.season.total).toBe(0);
  });

  it('a league with an upcoming round gets a status line and an event-soon up next, teams in pick order', async () => {
    await repo.createProfile({ id: 'u1', displayName: 'Joey', avatarUrl: null });
    const lg = await repo.createLeague({ slug: 'fam-abc234', name: 'Fam', defaultScoring: defaultScoring() });
    const me = await repo.createMember({ leagueId: lg.id, userId: 'u1', name: 'Joey', role: 'commissioner' });
    const r = await repo.createRound({
      leagueId: lg.id, eventKey: null, kind: 'manual', eventName: 'Ramp Riot', startDate: '2026-10-24',
      endDate: '2026-10-24', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    await repo.updateRound(r.id, { draftOrder: [me.id], rosterSize: 2 });
    await repo.insertPick({ roundId: r.id, pickNumber: 1, playerId: me.id, teamKey: 'frc254' });
    await repo.insertPick({ roundId: r.id, pickNumber: 0, playerId: me.id, teamKey: 'frc5181' });

    const page = await loadHome('u1', new Date('2026-10-01T12:00:00Z'));
    expect(page.leagues).toEqual([
      { slug: 'fam-abc234', name: 'Fam', isCommissioner: true, rank: 1, total: 0, line: 'Ramp Riot · starts Oct 24', error: false },
    ]);
    expect(page.upNext?.kind).toBe('event-soon');
    expect(page.upNext?.item.leagueSlug).toBe('fam-abc234');
    expect(page.upNext?.item.myTeams).toEqual(['frc5181', 'frc254']);
  });

  it("a league that fails to load is marked, and the others still show", async () => {
    await repo.createProfile({ id: 'u1', displayName: 'Joey', avatarUrl: null });
    const good = await repo.createLeague({ slug: 'good-abc234', name: 'Good', defaultScoring: defaultScoring() });
    const bad = await repo.createLeague({ slug: 'bad-abc234', name: 'Bad', defaultScoring: defaultScoring() });
    await repo.createMember({ leagueId: good.id, userId: 'u1', name: 'Joey', role: 'commissioner' });
    await repo.createMember({ leagueId: bad.id, userId: 'u1', name: 'Joey', role: 'player' });
    const real = repo.listRounds.bind(repo);
    vi.spyOn(repo, 'listRounds').mockImplementation(async (id) => {
      if (id === bad.id) throw new Error('boom');
      return real(id);
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const page = await loadHome('u1', new Date('2026-10-01T12:00:00Z'));
    expect(page.leagues).toEqual([
      { slug: 'good-abc234', name: 'Good', isCommissioner: true, rank: 1, total: 0, line: 'No events yet', error: false },
      { slug: 'bad-abc234', name: 'Bad', isCommissioner: false, rank: null, total: 0, line: "Couldn't load", error: true },
    ]);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
