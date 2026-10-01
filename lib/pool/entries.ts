import { getRepo } from '@/lib/db';
import type { RoundRow } from '@/lib/db/types';
import { loadPool } from '@/lib/rounds/pool';
import { teamStatsPoolLookup } from '@/lib/stats/pool';

/** One row of the draft pool (spec §6.3). Stats come from team_stats (SP3); null stats show as "New" in the UI. */
export type PoolEntry = {
  teamKey: string;
  nickname: string | null;
  proj: number | null;
  record: [number, number, number] | null;
  bestFinish: 'winner' | 'finalist' | 'captain' | 'picked' | null;
  opr: number | null;
  rank: number | null;
  available: boolean;
};
export type PoolStats = Omit<PoolEntry, 'teamKey' | 'nickname' | 'available'>;
export type PoolStatsLookup = (teamKeys: string[], season: number) => Promise<Map<string, PoolStats>>;

const NO_STATS: PoolStats = { proj: null, record: null, bestFinish: null, opr: null, rank: null };

export const noPoolStats: PoolStatsLookup = async () => new Map();

/** The stats source every caller uses. SP4 shipped noPoolStats here; SP3 swaps in team_stats. */
export const activePoolStats: PoolStatsLookup = teamStatsPoolLookup;

export async function buildPoolEntries(
  round: RoundRow,
  now: Date,
  stats: PoolStatsLookup = activePoolStats,
): Promise<PoolEntry[]> {
  const [pool, picks] = await Promise.all([loadPool(round, now), getRepo().listPicks(round.id)]);
  const taken = new Set(picks.map((p) => p.teamKey));
  const season = Number(round.startDate.slice(0, 4));
  const found = await stats(pool.teams.map((t) => t.teamKey), season);
  return pool.teams.map((t) => ({
    teamKey: t.teamKey,
    nickname: t.nickname,
    ...(found.get(t.teamKey) ?? NO_STATS),
    available: !taken.has(t.teamKey),
  }));
}
