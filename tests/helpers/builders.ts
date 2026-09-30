import type { Alliance, EventData, MatchSimple, RankingRow, RankingsResponse } from '@/lib/tba/types';

type MatchOpts = {
  level?: string;
  set?: number;
  num: number;
  red: string[];
  blue: string[];
  redScore?: number;
  blueScore?: number;
  /** Pass 'absent' to leave winning_alliance off the object entirely. */
  winner?: 'red' | 'blue' | '' | 'absent';
  redSurrogates?: string[];
  blueSurrogates?: string[];
  redDq?: string[];
  blueDq?: string[];
};

/** Builds a match. With no scores given, the match is unplayed (-1 / -1). */
export function match(o: MatchOpts): MatchSimple {
  const level = o.level ?? 'qm';
  const set = o.set ?? 1;
  const redScore = o.redScore ?? -1;
  const blueScore = o.blueScore ?? -1;
  const played = redScore >= 0 && blueScore >= 0;
  const auto = !played ? '' : redScore > blueScore ? 'red' : blueScore > redScore ? 'blue' : '';
  const m: MatchSimple = {
    key: `2099test_${level}${level === 'qm' ? '' : `${set}m`}${o.num}`,
    comp_level: level,
    set_number: set,
    match_number: o.num,
    alliances: {
      red: {
        score: redScore,
        team_keys: o.red,
        surrogate_team_keys: o.redSurrogates ?? [],
        dq_team_keys: o.redDq ?? [],
      },
      blue: {
        score: blueScore,
        team_keys: o.blue,
        surrogate_team_keys: o.blueSurrogates ?? [],
        dq_team_keys: o.blueDq ?? [],
      },
    },
  };
  if (o.winner !== 'absent') m.winning_alliance = o.winner ?? auto;
  return m;
}

export function rankRow(
  rank: number,
  teamKey: string,
  record: [number, number, number] | null,
  extra: Partial<RankingRow> = {},
): RankingRow {
  const played = record ? record[0] + record[1] + record[2] : 0;
  return {
    rank,
    team_key: teamKey,
    record: record ? { wins: record[0], losses: record[1], ties: record[2] } : null,
    matches_played: played,
    extra_stats: [],
    sort_orders: [],
    ...extra,
  };
}

/** Rankings in the modern shape: extra_stats[0] is "Total Ranking Points". */
export function rankings(rows: RankingRow[]): RankingsResponse {
  return {
    rankings: rows,
    extra_stats_info: [{ name: 'Total Ranking Points' }],
    sort_order_info: [{ name: 'Ranking Score' }],
  };
}

export function alliance(picks: string[], extra: Partial<Alliance> = {}): Alliance {
  return { name: null, picks, backup: null, status: null, ...extra };
}

export function emptyEvent(): EventData {
  return { teams: null, matches: null, rankings: null, alliances: null, awards: null, oprs: null };
}
