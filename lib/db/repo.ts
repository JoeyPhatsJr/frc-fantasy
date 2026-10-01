import type {
  AdjustmentRow,
  CacheRow,
  DraftMode,
  LeagueRole,
  LeagueRow,
  PickRow,
  PickSeconds,
  PlayerRow,
  ProfileRow,
  RoundRow,
  Visibility,
} from '@/lib/db/types';
import type { ScoringConfig } from '@/lib/scoring/config';

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
};
export type LeaguePatch = {
  name?: string;
  homeTeamNumber?: number;
  defaultScoring?: ScoringConfig;
  adminTokenHash?: string | null;
  visibility?: Visibility;
};
export type NewRound = {
  leagueId: string;
  eventKey: string;
  eventName: string;
  startDate: string;
  endDate: string;
  timezone: string;
  scoring: ScoringConfig;
};
export type RoundPatch = {
  rosterSize?: number;
  draftOrder?: string[];
  scoring?: ScoringConfig;
  finalizedAt?: string | null;
  draftMode?: DraftMode;
  pickSeconds?: PickSeconds | null;
  pausedRemainingMs?: number | null;
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
}
