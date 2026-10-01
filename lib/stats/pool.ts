import { getRepo } from '@/lib/db';
import type { BestFinish, TeamStatsAward, TeamStatsEvent, TeamStatsRow } from '@/lib/db/types';
import type { PoolStats, PoolStatsLookup } from '@/lib/pool/entries';
import { projection, type SeasonTotals } from '@/lib/stats/projection';

const totals = (r: TeamStatsRow | null): SeasonTotals | null =>
  r ? { points: r.totalPoints, events: r.eventsPlayed } : null;

function statsFor(cur: TeamStatsRow | null, prev: TeamStatsRow | null): PoolStats | null {
  const base = cur ?? prev;
  if (!base) return null;
  const latest = cur?.latestEventKey ? cur : prev?.latestEventKey ? prev : null;
  return {
    proj: projection(totals(cur), totals(prev)),
    record: [base.qualWins, base.qualLosses, base.qualTies],
    bestFinish: base.bestFinish,
    opr: latest?.latestOpr ?? null,
    rank: latest?.latestRank ?? null,
  };
}

/**
 * Draft-pool stats from team_stats for season Y and Y−1 (spec §6.1, §6.3). Never computes on the fly.
 * Fail-soft: the stats are decorative, so if team_stats can't be read every team shows "New" and
 * the pool and timeout auto-picks keep working (auto-pick falls back to the lowest team number).
 */
export const teamStatsPoolLookup: PoolStatsLookup = async (teamKeys, season) => {
  const out = new Map<string, PoolStats>();
  if (teamKeys.length === 0) return out;
  let rows: TeamStatsRow[];
  try {
    rows = await getRepo().getTeamStats(teamKeys, [season, season - 1]);
  } catch (err) {
    console.error('Could not read team_stats; the pool shows no stats', err);
    return out;
  }
  const key = (teamKey: string, s: number) => `${teamKey}|${s}`;
  const byKey = new Map(rows.map((r) => [key(r.teamKey, r.season), r]));
  for (const teamKey of teamKeys) {
    const stats = statsFor(byKey.get(key(teamKey, season)) ?? null, byKey.get(key(teamKey, season - 1)) ?? null);
    if (stats) out.set(teamKey, stats);
  }
  return out;
};

export type TeamSheetSeason = {
  season: number;
  eventsPlayed: number;
  totalPoints: number;
  record: [number, number, number];
  bestFinish: BestFinish | null;
  events: TeamStatsEvent[];
  awards: TeamStatsAward[];
};

export type TeamSheetData = { teamKey: string; season: number; proj: number | null; seasons: TeamSheetSeason[] };

/** The tap-a-team sheet (spec §6.3): per-event history for Y and Y−1, newest season first. */
export function teamSheet(teamKey: string, season: number, rows: TeamStatsRow[]): TeamSheetData {
  const mine = rows.filter((r) => r.teamKey === teamKey && (r.season === season || r.season === season - 1));
  const cur = mine.find((r) => r.season === season) ?? null;
  const prev = mine.find((r) => r.season === season - 1) ?? null;
  return {
    teamKey,
    season,
    proj: projection(totals(cur), totals(prev)),
    seasons: mine
      .sort((a, b) => b.season - a.season)
      .map((r) => ({
        season: r.season,
        eventsPlayed: r.eventsPlayed,
        totalPoints: r.totalPoints,
        record: [r.qualWins, r.qualLosses, r.qualTies],
        bestFinish: r.bestFinish,
        events: r.events,
        awards: r.awards,
      })),
  };
}
