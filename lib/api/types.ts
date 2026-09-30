import type { RoundStatus } from '@/lib/rounds/status';
import type { ScoringConfig } from '@/lib/scoring/config';

// Shapes the admin API returns. The admin pages import these, so server and client agree.

export type AdminLeague = {
  slug: string;
  name: string;
  homeTeamNumber: number;
  defaultScoring: ScoringConfig;
};

export type AdminPlayer = {
  id: string;
  name: string;
  /** True when the player has picks or adjustments, or is in any draft order. Such players can't be removed. */
  inUse: boolean;
};

export type AdminRoundSummary = {
  id: string;
  eventKey: string;
  eventName: string;
  startDate: string;
  endDate: string;
  status: RoundStatus;
  pickCount: number;
  totalPicks: number;
};

export type AdminState = {
  league: AdminLeague;
  players: AdminPlayer[];
  rounds: AdminRoundSummary[];
};
