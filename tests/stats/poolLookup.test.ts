import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));

import type { Repo } from '@/lib/db/repo';
import type { TeamStatsRow } from '@/lib/db/types';
import { teamSheet, teamStatsPoolLookup } from '@/lib/stats/pool';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
beforeEach(() => {
  repo = createMemoryRepo();
  h.repo = repo;
});

const row = (teamKey: string, season: number, extra: Partial<TeamStatsRow> = {}): TeamStatsRow => ({
  teamKey,
  season,
  eventsPlayed: 2,
  totalPoints: 80,
  qualWins: 10,
  qualLosses: 4,
  qualTies: 0,
  bestFinish: 'captain',
  awards: [],
  events: [],
  latestEventKey: `${season}pahat`,
  latestOpr: 40.1,
  latestRank: 5,
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...extra,
});

describe('teamStatsPoolLookup', () => {
  it('projects from both seasons and reads the rest from the draft season', async () => {
    await repo.upsertTeamStats([
      row('frc341', 2026, { totalPoints: 80, eventsPlayed: 2, qualWins: 12, bestFinish: 'winner', latestOpr: 55.5, latestRank: 1 }),
      row('frc341', 2025, { totalPoints: 30, eventsPlayed: 1 }),
    ]);
    const stats = await teamStatsPoolLookup(['frc341'], 2026);
    // (2 × 80 + 30) / (2 × 2 + 1) = 38
    expect(stats.get('frc341')).toEqual({ proj: 38, record: [12, 4, 0], bestFinish: 'winner', opr: 55.5, rank: 1 });
  });

  // Final review I4: stats are decorative; a team_stats failure must not stall the pool or auto-pick.
  it('logs and returns no stats (every team "New") when the team_stats query throws', async () => {
    h.repo = { ...repo, getTeamStats: async () => { throw new Error('relation "team_stats" does not exist'); } };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stats = await teamStatsPoolLookup(['frc341', 'frc5181'], 2026);
    expect(stats.size).toBe(0);
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  // Review Focus 5.
  it('falls back to last season when the team has no row this season', async () => {
    await repo.upsertTeamStats([row('frc5181', 2025, { totalPoints: 90, eventsPlayed: 3, bestFinish: 'picked', latestOpr: 20, latestRank: 12 })]);
    expect((await teamStatsPoolLookup(['frc5181'], 2026)).get('frc5181')).toEqual({
      proj: 30,
      record: [10, 4, 0],
      bestFinish: 'picked',
      opr: 20,
      rank: 12,
    });
  });

  it('takes OPR/rank from last season when this season has results but no OPR/rank yet', async () => {
    await repo.upsertTeamStats([
      row('frc1', 2026, { latestEventKey: null, latestOpr: null, latestRank: null }),
      row('frc1', 2025, { latestOpr: 33.3, latestRank: 7 }),
    ]);
    const got = (await teamStatsPoolLookup(['frc1'], 2026)).get('frc1')!;
    expect(got.opr).toBe(33.3);
    expect(got.rank).toBe(7);
    expect(got.record).toEqual([10, 4, 0]);
  });

  it('leaves teams with no rows out, so the pool shows "New"', async () => {
    await repo.upsertTeamStats([row('frc341', 2026)]);
    const stats = await teamStatsPoolLookup(['frc341', 'frc9999'], 2026);
    expect(stats.has('frc9999')).toBe(false);
    expect(await teamStatsPoolLookup([], 2026)).toEqual(new Map());
  });

  it('ignores seasons other than Y and Y−1', async () => {
    await repo.upsertTeamStats([row('frc341', 2024)]);
    expect((await teamStatsPoolLookup(['frc341'], 2026)).size).toBe(0);
  });
});

describe('teamSheet', () => {
  it('lists the draft season first, with the projection', () => {
    const data = teamSheet('frc341', 2026, [row('frc341', 2025), row('frc341', 2026)]);
    expect(data.seasons.map((s) => s.season)).toEqual([2026, 2025]);
    expect(data.proj).toBe(40);
    expect(data.seasons[0].record).toEqual([10, 4, 0]);
  });

  it('is empty with proj null for a New team', () => {
    expect(teamSheet('frc9999', 2026, [])).toEqual({ teamKey: 'frc9999', season: 2026, proj: null, seasons: [] });
  });
});
