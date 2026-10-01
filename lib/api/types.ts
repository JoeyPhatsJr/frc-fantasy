import type { DraftMode, LeagueRole, PickSeconds, RoundKind, Visibility } from '@/lib/db/types';
import type { DraftPhase } from '@/lib/draft/live';
import type { RoundStatus } from '@/lib/rounds/status';
import type { ScoringConfig } from '@/lib/scoring/config';
import type { ManualResult } from '@/lib/scoring/types';
import type { PoolFilter } from '@/lib/season/poolFilter';
import type { PoolTeam } from '@/lib/teams';

// Shapes the admin API returns. The admin pages import these, so server and client agree.

export type AdminLeague = {
  slug: string;
  name: string;
  homeTeamNumber: number;
  defaultScoring: ScoringConfig;
  inviteCode: string;
  visibility: Visibility;
};

export type AdminPlayer = {
  id: string;
  name: string;
  /** True when the player has picks or adjustments, or is in any draft order. Removing them unlinks instead of deleting. */
  inUse: boolean;
  role: LeagueRole;
  /** False for a former member ("Mom (left)"). */
  linked: boolean;
};

export type AdminRoundSummary = {
  id: string;
  /** null for manual and season rounds. */
  eventKey: string | null;
  kind: RoundKind;
  autoAdded: boolean;
  seasonYear: number | null;
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
  /** The viewer's own player id, for "(you)". */
  me: string;
};

export type AdminRoundDetail = {
  round: {
    id: string;
    /** null for manual and season rounds. */
    eventKey: string | null;
    kind: RoundKind;
    seasonYear: number | null;
    poolFilter: PoolFilter | null;
    eventName: string;
    startDate: string;
    endDate: string;
    timezone: string;
    rosterSize: number;
    draftOrder: string[];
    scoring: ScoringConfig;
    finalizedAt: string | null;
    draftMode: DraftMode;
    pickSeconds: PickSeconds | null;
    draftStartedAt: string | null;
    draftPausedAt: string | null;
  };
  /** Live-draft phase (v2 §7.1); 'setup' until started, for commissioner-mode rounds until full. */
  draftPhase: DraftPhase;
  status: RoundStatus;
  /** True when the event is over but the round isn't final yet (spec §5.5). */
  nudgeFinalize: boolean;
  /** Every player in the league, not only the ones drafting. */
  players: { id: string; name: string }[];
  pool: PoolTeam[];
  /** True when TBA couldn't be reached and the pool may be out of date. */
  poolStale: boolean;
  picks: { pickNumber: number; playerId: string; teamKey: string }[];
  adjustments: {
    id: string;
    playerId: string | null;
    teamKey: string | null;
    points: number;
    reason: string;
  }[];
  /** Largest roster size the pool allows for the current draft order, capped at 10. null with no drafters. */
  maxRosterSize: number | null;
  /** Typed-in results (spec §5.3). null unless the round is a manual event. */
  manualResults: ManualResult[] | null;
};

/** GET /admin/events/{eventKey}: a look-up only, so the commissioner can check the event before adding it. */
export type EventLookup =
  | { found: false; eventKey: string }
  | {
      found: true;
      eventKey: string;
      name: string;
      startDate: string;
      endDate: string;
      /** True when this league already has a round for the event (adding it again would answer 409). */
      alreadyInLeague: boolean;
    };

/** GET /api/invites/{code}: what the /join page shows before joining (spec §4.6). */
export type InvitePreview = {
  slug: string;
  name: string;
  /** The first commissioner who still has an account. */
  commissioner: string | null;
  memberCount: number;
  full: boolean;
  alreadyMember: boolean;
};
