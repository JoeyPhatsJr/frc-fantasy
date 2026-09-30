import type { ScoringConfig } from '@/lib/scoring/config';

export type LeagueRow = {
  id: string;
  slug: string;
  name: string;
  adminTokenHash: string;
  homeTeamNumber: number;
  defaultScoring: ScoringConfig;
  createdAt: string;
};

export type PlayerRow = { id: string; leagueId: string; name: string; createdAt: string };

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
