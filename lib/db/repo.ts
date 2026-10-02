import type {
  AdjustmentRow,
  CacheMeta,
  CacheRow,
  DraftMode,
  EventScoresRow,
  LeagueFormat,
  LeagueRole,
  ManualResultRow,
  LeagueRow,
  PickRow,
  PickSeconds,
  PlayerRow,
  ProfileRow,
  RoundKind,
  RoundRow,
  TeamStatsRow,
  Visibility,
} from '@/lib/db/types';
import type { ScoringConfig } from '@/lib/scoring/config';
import type { PoolFilter } from '@/lib/season/poolFilter';

/** Thrown when an insert or update breaks a unique constraint. `constraint` is the Postgres name. */
export class UniqueViolation extends Error {
  constructor(public readonly constraint: string) {
    super(`Unique constraint violated: ${constraint}`);
    this.name = 'UniqueViolation';
  }
}

/** Thrown when the database can't be reached (for example, a paused Supabase project). */
export class DbUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbUnavailableError';
  }
}

export type NewLeague = {
  slug: string;
  name: string;
  defaultScoring: ScoringConfig;
  createdBy?: string | null;
  visibility?: Visibility;
  /** v1 only. v2 leagues leave it out. */
  adminTokenHash?: string | null;
  format?: LeagueFormat; // default 'event'
};
export type LeaguePatch = {
  name?: string;
  homeTeamNumber?: number;
  defaultScoring?: ScoringConfig;
  adminTokenHash?: string | null;
  visibility?: Visibility;
  followsSyncedAt?: string;
};
export type NewRound = {
  leagueId: string;
  /** null for manual and season rounds. */
  eventKey: string | null;
  eventName: string;
  startDate: string;
  endDate: string;
  timezone: string;
  scoring: ScoringConfig;
  kind?: RoundKind; // default 'tba'
  seasonYear?: number | null;
  poolFilter?: PoolFilter | null;
  autoAdded?: boolean;
  rosterSize?: number; // default 4
  draftOrder?: string[]; // default []
};
export type RoundPatch = {
  rosterSize?: number;
  draftOrder?: string[];
  scoring?: ScoringConfig;
  finalizedAt?: string | null;
  draftMode?: DraftMode;
  pickSeconds?: PickSeconds | null;
  pausedRemainingMs?: number | null;
  startDate?: string;
  endDate?: string;
  poolFilter?: PoolFilter | null;
  autoFinalize?: boolean;
};
export type NewPick = { roundId: string; pickNumber: number; playerId: string; teamKey: string; auto?: boolean };
export type NewAdjustment = {
  roundId: string;
  playerId: string | null;
  teamKey: string | null;
  points: number;
  reason: string;
};
export type AdjustmentPatch = {
  playerId?: string | null;
  teamKey?: string | null;
  points?: number;
  reason?: string;
};

export type NewProfile = { id: string; displayName: string; avatarUrl: string | null };
export type ProfilePatch = { displayName?: string; frcTeam?: number | null };
export type NewMember = { leagueId: string; userId: string; name: string; role: LeagueRole };
export type PlayerPatch = { name?: string; role?: LeagueRole; userId?: null };
export type MemberLeague = { league: LeagueRow; player: PlayerRow };
export type AtomicPick = {
  roundId: string;
  pickNumber: number;
  playerId: string;
  teamKey: string;
  /** true = only pick if the database clock is past pick_deadline (timeouts). */
  requireDue: boolean;
  /** true = made by tick/advance, not a person. */
  auto: boolean;
};
export type DraftAction = 'start' | 'pause' | 'resume';

export interface Repo {
  createLeague(input: NewLeague): Promise<LeagueRow>;
  getLeagueBySlug(slug: string): Promise<LeagueRow | null>;
  updateLeague(id: string, patch: LeaguePatch): Promise<LeagueRow>;
  deleteLeague(id: string): Promise<void>;
  getLeagueByInviteCode(code: string): Promise<LeagueRow | null>;
  /** New random code; retries up to 3 times if it collides. */
  resetInviteCode(leagueId: string): Promise<LeagueRow>;
  countLeaguesCreatedBy(userId: string): Promise<number>;
  /** Oldest league first. */
  listLeaguesForUser(userId: string): Promise<MemberLeague[]>;

  listPlayers(leagueId: string): Promise<PlayerRow[]>; // oldest first
  createPlayer(leagueId: string, name: string): Promise<PlayerRow>;
  renamePlayer(id: string, name: string): Promise<PlayerRow>;
  deletePlayer(id: string): Promise<void>;
  createMember(input: NewMember): Promise<PlayerRow>;
  getMemberByUser(leagueId: string, userId: string): Promise<PlayerRow | null>;
  updatePlayer(id: string, patch: PlayerPatch): Promise<PlayerRow>;

  getProfile(id: string): Promise<ProfileRow | null>;
  /** Returns the existing row unchanged if the profile already exists. */
  createProfile(input: NewProfile): Promise<ProfileRow>;
  updateProfile(id: string, patch: ProfilePatch): Promise<ProfileRow>;
  /** Deletes the Supabase Auth user. The profile cascades; players.user_id and leagues.created_by become null. */
  deleteUser(id: string): Promise<void>;

  listRounds(leagueId: string): Promise<RoundRow[]>; // by start date, then creation time
  getRound(id: string): Promise<RoundRow | null>;
  createRound(input: NewRound): Promise<RoundRow>;
  updateRound(id: string, patch: RoundPatch): Promise<RoundRow>;
  deleteRound(id: string): Promise<void>;
  /** Idempotent insert for follow-a-team (spec §5.4): null when the league already has that event. */
  createRoundIfAbsent(input: NewRound): Promise<RoundRow | null>;
  /** kind = 'season' and not finalized, across every league (daily cron). */
  listOpenSeasonRounds(): Promise<RoundRow[]>;
  /** Not final and auto-finalize on, across all leagues (spec 2026-10-02 §5). */
  listAutoFinalizeCandidates(): Promise<RoundRow[]>;

  listManualResults(roundId: string): Promise<ManualResultRow[]>; // by team key
  upsertManualResult(row: ManualResultRow): Promise<ManualResultRow>;
  deleteManualResult(roundId: string, teamKey: string): Promise<void>;

  listFollows(leagueId: string): Promise<number[]>; // ascending
  setFollows(leagueId: string, teamNumbers: number[]): Promise<void>; // replaces the whole list
  listLeaguesWithFollows(): Promise<LeagueRow[]>;
  listSkippedEvents(leagueId: string): Promise<string[]>;
  addSkippedEvent(leagueId: string, eventKey: string): Promise<void>; // adding twice is fine

  listExtraTeams(roundId: string): Promise<string[]>;
  addExtraTeam(roundId: string, teamKey: string): Promise<void>; // adding twice is fine
  removeExtraTeam(roundId: string, teamKey: string): Promise<void>;

  listPicks(roundId: string): Promise<PickRow[]>; // by pick number
  listPicksForRounds(roundIds: string[]): Promise<PickRow[]>;
  insertPick(input: NewPick): Promise<PickRow>;
  deletePick(roundId: string, pickNumber: number): Promise<void>;
  updatePickTeam(roundId: string, pickNumber: number, teamKey: string): Promise<PickRow>;

  listAdjustments(roundId: string): Promise<AdjustmentRow[]>; // oldest first
  listAdjustmentsForRounds(roundIds: string[]): Promise<AdjustmentRow[]>;
  getAdjustment(id: string): Promise<AdjustmentRow | null>;
  insertAdjustment(input: NewAdjustment): Promise<AdjustmentRow>;
  updateAdjustment(id: string, patch: AdjustmentPatch): Promise<AdjustmentRow>;
  deleteAdjustment(id: string): Promise<void>;

  getCache(path: string): Promise<CacheRow | null>;
  upsertCache(row: CacheRow): Promise<void>;
  /** Metadata for the given tba_cache paths (no bodies), for the rows that exist. One round trip per 100 paths. */
  getCacheMeta(paths: string[]): Promise<CacheMeta[]>;

  // Derived caches (spec §5.6, §6.1). Written only by lib/scores/eventScores.ts and lib/stats/build.ts.
  getEventScoresRow(eventKey: string, configHash: string): Promise<EventScoresRow | null>;
  upsertEventScoresRow(row: EventScoresRow): Promise<void>;
  /** Deletes every event_scores row; returns how many. Only scripts/rebuild-event-scores.ts calls this. */
  clearEventScores(): Promise<number>;
  /** Without withHistory, awards and events come back empty (the draft pool only needs the summary). */
  getTeamStats(teamKeys: string[], seasons: number[], opts?: { withHistory?: boolean }): Promise<TeamStatsRow[]>;
  upsertTeamStats(rows: TeamStatsRow[]): Promise<void>;

  // Live draft (v2 §7). Each returns false instead of throwing when the draft state doesn't allow it.
  makePickAtomic(input: AtomicPick): Promise<boolean>;
  undoPickAtomic(roundId: string, pickNumber: number): Promise<boolean>;
  draftControl(roundId: string, action: DraftAction): Promise<boolean>;
  getQueue(roundId: string, playerId: string): Promise<string[]>;
  setQueue(roundId: string, playerId: string, teamKeys: string[]): Promise<void>;
  getAutodraft(roundId: string, playerId: string): Promise<boolean>;
  setAutodraft(roundId: string, playerId: string, on: boolean): Promise<void>;
  listAutodraftPlayers(roundId: string): Promise<string[]>;
  /** Tables in `public` with RLS off. Must always be empty (v2 §8.1). */
  rlsDisabledTables(): Promise<string[]>;
}
