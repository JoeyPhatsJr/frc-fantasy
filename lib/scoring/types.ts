export type CategoryId =
  | 'qualRecord'
  | 'rankingPoints'
  | 'rank'
  | 'alliance'
  | 'playoffWins'
  | 'eventResult'
  | 'awards'
  | 'oprBonus'
  | 'adjustment';

export type Line = { category: CategoryId; label: string; quantity?: number; points: number };

export type TeamScore = { teamKey: string; total: number; lines: Line[] };

export type RpMethod = 'extra_stats' | 'sort_order_avg' | 'none';

export type EventScores = {
  teams: Map<string, TeamScore>;
  qualsComplete: boolean;
  rpMethod: RpMethod;
};

export type Pick = { pickNumber: number; playerId: string; teamKey: string };

export type Adjustment = {
  id: string;
  playerId: string | null;
  teamKey: string | null;
  points: number;
  reason: string;
};

export type Player = { id: string; name: string };

export type PlayerRoundScore = {
  playerId: string;
  name: string;
  total: number;
  rank: number;
  /** Drafted teams in pick order, each including any team-targeted adjustment lines. */
  teams: TeamScore[];
  /** Player-targeted adjustments. */
  adjustments: Line[];
};

export type SeasonRow = {
  playerId: string;
  name: string;
  total: number;
  rank: number;
  /** One entry per round, in the order rounds were passed in. 0 if the player was not in that round. */
  perRound: number[];
};

export type AllianceRole = 'captain' | 'pick1' | 'pick2' | 'pick3' | 'backup';

/** One team's typed-in results for a manual round (spec §5.3). null = unknown. */
export type ManualResult = {
  teamKey: string;
  qualWins: number;
  qualLosses: number;
  qualTies: number;
  rankingPoints: number | null;
  qualRank: number | null;
  allianceRole: AllianceRole | null;
  playoffWins: number;
  eventResult: 'winner' | 'finalist' | null;
  /** TBA award type ids. */
  awardTypes: number[];
};
