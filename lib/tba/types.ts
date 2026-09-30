// Only the TBA fields this app reads. TBA sends more; we ignore the rest.

export type TeamSimple = {
  key: string;
  team_number: number;
  nickname?: string | null;
};

export type MatchAlliance = {
  score: number | null;
  team_keys: string[];
  surrogate_team_keys?: string[] | null;
  dq_team_keys?: string[] | null;
};

export type MatchSimple = {
  key: string;
  comp_level: string; // 'qm' | 'ef' | 'qf' | 'sf' | 'f'
  set_number: number;
  match_number: number;
  alliances: { red: MatchAlliance; blue: MatchAlliance } | null;
  /** 'red' | 'blue' | '' (no winner). May be missing entirely on old data. */
  winning_alliance?: string | null;
};

export type RankingRow = {
  rank: number;
  team_key: string;
  record: { wins: number; losses: number; ties: number } | null;
  matches_played: number;
  extra_stats?: number[] | null;
  sort_orders?: number[] | null;
};

export type RankingsResponse = {
  rankings: RankingRow[] | null;
  extra_stats_info?: { name: string }[] | null;
  sort_order_info?: { name: string }[] | null;
};

export type Alliance = {
  name?: string | null;
  picks: string[];
  backup?: { in: string; out: string } | null;
  status?: { level?: string | null; status?: string | null } | null;
};

export type Award = {
  name: string;
  award_type: number;
  recipient_list: { team_key: string | null; awardee: string | null }[];
};

export type OprsResponse = {
  oprs?: Record<string, number> | null;
};

export type TbaEvent = {
  key: string;
  name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;
  timezone?: string | null;
  event_type?: number;
};

export type EventData = {
  teams: TeamSimple[] | null;
  matches: MatchSimple[] | null;
  rankings: RankingsResponse | null;
  alliances: Alliance[] | null;
  awards: Award[] | null;
  oprs: OprsResponse | null;
};
