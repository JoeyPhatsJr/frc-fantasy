import type { ScoringConfig } from '@/lib/scoring/config';

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

export type RoundRow = {
  id: string;
  leagueId: string;
  eventKey: string;
  eventName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  timezone: string;
  rosterSize: number;
  draftOrder: string[];
  scoring: ScoringConfig;
  finalizedAt: string | null;
  createdAt: string;
};

export type PickRow = {
  id: string;
  roundId: string;
  pickNumber: number;
  playerId: string;
  teamKey: string;
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
