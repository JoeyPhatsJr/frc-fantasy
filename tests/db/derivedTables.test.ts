import { beforeEach, describe, expect, it } from 'vitest';
import type { Repo } from '@/lib/db/repo';
import type { EventScoresRow, TeamStatsRow } from '@/lib/db/types';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
beforeEach(() => {
  repo = createMemoryRepo();
});

const scoresRow = (extra: Partial<EventScoresRow> = {}): EventScoresRow => ({
  eventKey: '2025parr',
  configHash: 'c1',
  sourceStamp: 's1',
  scores: { teams: {}, qualsComplete: true, rpMethod: 'extra_stats' },
  info: { teamNames: {}, hasEventData: true, hasRankings: true },
  computedAt: '2026-10-24T12:00:00.000Z',
  ...extra,
});

const statsRow = (teamKey: string, season: number, extra: Partial<TeamStatsRow> = {}): TeamStatsRow => ({
  teamKey,
  season,
  eventsPlayed: 2,
  totalPoints: 80,
  qualWins: 9,
  qualLosses: 3,
  qualTies: 0,
  bestFinish: 'captain',
  awards: [{ type: 0, name: 'Impact Award', eventKey: `${season}paca` }],
  events: [{ eventKey: `${season}paca`, name: 'Greater Pittsburgh', endDate: `${season}-03-15`, rank: 2, finish: 'captain', points: 44 }],
  latestEventKey: `${season}paca`,
  latestOpr: 41.2,
  latestRank: 2,
  updatedAt: '2026-10-24T12:00:00.000Z',
  ...extra,
});

describe('event_scores', () => {
  it('stores one row per (event, config) and replaces it on upsert', async () => {
    await repo.upsertEventScoresRow(scoresRow());
    await repo.upsertEventScoresRow(scoresRow({ configHash: 'c2' }));
    await repo.upsertEventScoresRow(scoresRow({ sourceStamp: 's2' }));

    expect((await repo.getEventScoresRow('2025parr', 'c1'))?.sourceStamp).toBe('s2');
    expect((await repo.getEventScoresRow('2025parr', 'c2'))?.sourceStamp).toBe('s1');
    expect(await repo.getEventScoresRow('2025parr', 'nope')).toBeNull();
  });

  it('can be cleared completely (the cache is rebuildable)', async () => {
    await repo.upsertEventScoresRow(scoresRow());
    await repo.upsertEventScoresRow(scoresRow({ eventKey: '2026parr' }));
    expect(await repo.clearEventScores()).toBe(2);
    expect(await repo.getEventScoresRow('2025parr', 'c1')).toBeNull();
  });
});

describe('team_stats', () => {
  it('returns only the asked-for teams and seasons, summary columns by default', async () => {
    await repo.upsertTeamStats([statsRow('frc341', 2026), statsRow('frc341', 2025), statsRow('frc5181', 2026), statsRow('frc341', 2024)]);

    const rows = await repo.getTeamStats(['frc341'], [2026, 2025]);
    expect(rows.map((r) => r.season).sort()).toEqual([2025, 2026]);
    expect(rows.every((r) => r.awards.length === 0 && r.events.length === 0)).toBe(true);
    expect(rows[0].latestOpr).toBe(41.2);
  });

  it('includes awards and per-event history when asked', async () => {
    await repo.upsertTeamStats([statsRow('frc341', 2026)]);
    const [row] = await repo.getTeamStats(['frc341'], [2026], { withHistory: true });
    expect(row.events).toHaveLength(1);
    expect(row.awards[0].name).toBe('Impact Award');
  });

  it('replaces a (team, season) row on upsert', async () => {
    await repo.upsertTeamStats([statsRow('frc341', 2026)]);
    await repo.upsertTeamStats([statsRow('frc341', 2026, { totalPoints: 120 })]);
    const rows = await repo.getTeamStats(['frc341'], [2026]);
    expect(rows).toHaveLength(1);
    expect(rows[0].totalPoints).toBe(120);
  });

  it('handles empty inputs', async () => {
    await repo.upsertTeamStats([]);
    expect(await repo.getTeamStats([], [2026])).toEqual([]);
  });
});
