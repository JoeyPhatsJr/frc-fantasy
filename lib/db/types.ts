import type { ScoringConfig } from '@/lib/scoring/config';
import type { PoolFilter } from '@/lib/season/poolFilter';

export type LeagueFormat = 'event' | 'season';
export type RoundKind = 'tba' | 'manual' | 'season';

export type Visibility = 'link' | 'members';
export type LeagueRole = 'commissioner' | 'player';

export type LeagueRow = {
  id: string;
  slug: string;
  name: string;
  /** v1 only; null for every v2 league. Column dropped in 0006. */
  adminTokenHash: string | null;
  homeTeamNumber: number;
  defaultScoring: ScoringConfig;
  inviteCode: string;
  visibility: Visibility;
  createdBy: string | null;
  format: LeagueFormat;
  /** Last successful follow-a-team sync (spec §5.4). null = never. */
  followsSyncedAt: string | null;
  createdAt: string;
};

export type PlayerRow = {
  id: string;
  leagueId: string;
  name: string;
  /** null = an unlinked former member ("Mom (left)"), or a name-only row made by tests/scripts. */
  userId: string | null;
  role: LeagueRole;
  createdAt: string;
};

export type ProfileRow = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  frcTeam: number | null;
  createdAt: string;
};

export type PickSeconds = 30 | 60 | 90 | 120;
export const PICK_SECONDS: readonly PickSeconds[] = [30, 60, 90, 120];
export type DraftMode = 'commissioner' | 'live';

export type RoundRow = {
  id: string;
  leagueId: string;
  /** null for manual and season rounds. */
  eventKey: string | null;
  eventName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  timezone: string;
  rosterSize: number;
  draftOrder: string[];
  scoring: ScoringConfig;
  finalizedAt: string | null;
  draftMode: DraftMode;
  /** null = no pick timer. */
  pickSeconds: PickSeconds | null;
  draftStartedAt: string | null;
  /** Non-null = paused. */
  draftPausedAt: string | null;
  /** Time left on the clock when paused; null = give the full timer on resume. */
  pausedRemainingMs: number | null;
  /** The current pick's deadline (database clock); null if no timer, paused, not started, or done. */
  pickDeadline: string | null;
  kind: RoundKind;
  /** Season rounds only. */
  seasonYear: number | null;
  /** Season rounds only; null means "all teams". */
  poolFilter: PoolFilter | null;
  /** Created by follow-a-team (spec §5.4). */
  autoAdded: boolean;
  createdAt: string;
};

export type PickRow = {
  id: string;
  roundId: string;
  pickNumber: number;
  playerId: string;
  teamKey: string;
  /** True when tick/advance made the pick. */
  auto: boolean;
  createdAt: string;
};

export type AdjustmentRow = {
  id: string;
  roundId: string;
  playerId: string | null;
  teamKey: string | null;
  points: number;
  reason: string;
  createdAt: string;
};

export type CacheRow = {
  path: string;
  etag: string | null;
  /** null = TBA had no data (JSON null or 404). */
  body: unknown | null;
  fetchedAt: string;
  lastError: string | null;
  lastErrorAt: string | null;
};

/** tba_cache without the body: what getEventScores needs to decide if its cached scores are current. */
export type CacheMeta = {
  path: string;
  fetchedAt: string;
  /** sha256 of the canonical JSON body; null when TBA had no data. */
  bodyHash: string | null;
  lastErrorAt: string | null;
};

/** One row of the derived event_scores cache (spec §5.6). `scores` and `info` are validated on read. */
export type EventScoresRow = {
  eventKey: string;
  configHash: string;
  sourceStamp: string;
  scores: unknown;
  info: unknown;
  computedAt: string;
};

export type BestFinish = 'winner' | 'finalist' | 'captain' | 'picked';

export type TeamStatsAward = { type: number; name: string; eventKey: string };

export type TeamStatsEvent = {
  eventKey: string;
  name: string;
  endDate: string; // YYYY-MM-DD
  rank: number | null;
  finish: BestFinish | null;
  points: number;
};

/** One row of the derived team_stats table (spec §6.1): one team, one season, default scoring. */
export type TeamStatsRow = {
  teamKey: string;
  season: number;
  eventsPlayed: number;
  totalPoints: number;
  qualWins: number;
  qualLosses: number;
  qualTies: number;
  bestFinish: BestFinish | null;
  awards: TeamStatsAward[];
  events: TeamStatsEvent[];
  latestEventKey: string | null;
  latestOpr: number | null;
  latestRank: number | null;
  updatedAt: string;
};
