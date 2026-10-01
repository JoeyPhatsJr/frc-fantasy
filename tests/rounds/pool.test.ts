import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import type { Repo } from '@/lib/db/repo';
import { buildPoolEntries, noPoolStats } from '@/lib/pool/entries';
import { loadPool } from '@/lib/rounds/pool';
import { defaultScoring } from '@/lib/scoring/config';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
const NOW = new Date('2026-11-01T12:00:00.000Z');

beforeEach(() => {
  repo = createMemoryRepo();
  h.repo = repo;
  h.getTba = vi.fn(async () => ({ data: null, fetchedAt: null, stale: true }));
});

describe('loadPool for a manual round', () => {
  it('is exactly the hand-added teams, sorted, with no TBA call', async () => {
    const { league } = await seedLeague(repo);
    const round = await repo.createRound({
      leagueId: league.id, eventKey: null, kind: 'manual', eventName: 'Garage Games',
      startDate: '2026-11-07', endDate: '2026-11-07', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    await repo.addExtraTeam(round.id, 'frc5181');
    await repo.addExtraTeam(round.id, 'frc341');
    const pool = await loadPool(round, NOW);
    expect(pool.teams.map((t) => t.teamKey)).toEqual(['frc341', 'frc5181']);
    expect(pool).toMatchObject({ stale: false, tbaCount: 0 });
    expect(h.getTba).not.toHaveBeenCalled();
  });

  it('gives the draft pool (buildPoolEntries) the hand-added teams, marking drafted ones taken', async () => {
    const { league, commissioner } = await seedLeague(repo);
    const round = await repo.createRound({
      leagueId: league.id, eventKey: null, kind: 'manual', eventName: 'Garage Games',
      startDate: '2026-11-07', endDate: '2026-11-07', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    await repo.addExtraTeam(round.id, 'frc5181');
    await repo.addExtraTeam(round.id, 'frc341');
    await repo.updateRound(round.id, { draftOrder: [commissioner.id], rosterSize: 1 });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: commissioner.id, teamKey: 'frc341' });
    const entries = await buildPoolEntries(round, NOW, noPoolStats);
    expect(entries.map((e) => [e.teamKey, e.available])).toEqual([['frc341', false], ['frc5181', true]]);
    expect(h.getTba).not.toHaveBeenCalled();
  });
});
