import type { ScoringConfig } from '@/lib/scoring/config';
import { creditedTeams, hasResult, winnerOf } from '@/lib/scoring/matches';
import type { Line, RpMethod } from '@/lib/scoring/types';
import type { MatchSimple, RankingsResponse } from '@/lib/tba/types';

export type QualRecord = { wins: number; losses: number; ties: number };

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function rankTierPoints(rank: number, tiers: { maxRank: number; points: number }[]): number {
  if (!Number.isFinite(rank) || rank < 1) return 0;
  for (const tier of tiers) {
    if (tier.maxRank >= rank) return tier.points;
  }
  return 0;
}

export function extractRp(rankings: RankingsResponse | null): {
  method: RpMethod;
  byTeam: Map<string, number>;
} {
  const rows = rankings?.rankings ?? [];
  const byTeam = new Map<string, number>();

  const extraIndex = (rankings?.extra_stats_info ?? []).findIndex((i) =>
    (i?.name ?? '').toLowerCase().includes('total ranking points'),
  );
  if (extraIndex >= 0) {
    for (const row of rows) byTeam.set(row.team_key, Math.round(num(row.extra_stats?.[extraIndex])));
    return { method: 'extra_stats', byTeam };
  }

  const firstSort = (rankings?.sort_order_info?.[0]?.name ?? '').toLowerCase();
  if (firstSort.includes('ranking score') || firstSort.includes('ranking points')) {
    for (const row of rows) {
      byTeam.set(row.team_key, Math.round(num(row.sort_orders?.[0]) * num(row.matches_played)));
    }
    return { method: 'sort_order_avg', byTeam };
  }

  return { method: 'none', byTeam };
}

function recordsFromMatches(matches: MatchSimple[] | null): Map<string, QualRecord> {
  const out = new Map<string, QualRecord>();
  const rec = (k: string) => {
    let r = out.get(k);
    if (!r) {
      r = { wins: 0, losses: 0, ties: 0 };
      out.set(k, r);
    }
    return r;
  };
  for (const m of matches ?? []) {
    if (m.comp_level !== 'qm' || !hasResult(m)) continue;
    const winner = winnerOf(m);
    for (const side of ['red', 'blue'] as const) {
      for (const team of creditedTeams(m, side)) {
        if (winner === null) rec(team).ties += 1;
        else if (winner === side) rec(team).wins += 1;
        else rec(team).losses += 1;
      }
    }
  }
  return out;
}

export function qualRecords(
  rankings: RankingsResponse | null,
  matches: MatchSimple[] | null,
): Map<string, QualRecord> {
  const out = recordsFromMatches(matches);
  for (const row of rankings?.rankings ?? []) {
    if (row.record) {
      out.set(row.team_key, {
        wins: num(row.record.wins),
        losses: num(row.record.losses),
        ties: num(row.record.ties),
      });
    }
  }
  return out;
}

export function qualLines(
  data: { rankings: RankingsResponse | null; matches: MatchSimple[] | null },
  config: ScoringConfig,
  qualsDone: boolean,
): { lines: Map<string, Line[]>; rpMethod: RpMethod } {
  const lines = new Map<string, Line[]>();
  const push = (team: string, line: Line) => {
    const list = lines.get(team) ?? [];
    list.push(line);
    lines.set(team, list);
  };

  for (const [team, r] of qualRecords(data.rankings, data.matches)) {
    push(team, {
      category: 'qualRecord',
      label: `Qual record ${r.wins}-${r.losses}-${r.ties}`,
      points: r.wins * config.qualWin + r.ties * config.qualTie + r.losses * config.qualLoss,
    });
  }

  const rp = extractRp(data.rankings);
  for (const [team, total] of rp.byTeam) {
    push(team, {
      category: 'rankingPoints',
      label: `Ranking points ${total}`,
      quantity: total,
      points: total * config.rankingPoint,
    });
  }

  for (const row of data.rankings?.rankings ?? []) {
    if (num(row.matches_played) <= 0) continue; // a rank before any match is a placeholder
    push(row.team_key, {
      category: 'rank',
      label: `${qualsDone ? 'Final' : 'Current'} rank #${row.rank}`,
      quantity: row.rank,
      points: rankTierPoints(row.rank, config.rankTiers),
    });
  }

  return { lines, rpMethod: rp.method };
}
