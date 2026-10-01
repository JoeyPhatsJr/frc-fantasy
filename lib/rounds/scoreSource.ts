import { getRepo } from '@/lib/db';
import type { RoundRow } from '@/lib/db/types';
import { cacheWindowFor } from '@/lib/rounds/status';
import { getEventScores } from '@/lib/scores/eventScores';
import { scoreManualEvent } from '@/lib/scoring/manual';
import type { RpMethod, TeamScore } from '@/lib/scoring/types';
import { scoreSeasonRound, type SeasonTeamDetail } from '@/lib/season/score';

/** What any round kind contributes to its round page: scored teams plus what the page says about the data. */
export type RoundScoreSource = {
  teams: Map<string, TeamScore>;
  qualsComplete: boolean;
  rpMethod: RpMethod;
  /** teamKey -> nickname, for teams TBA knows about. */
  teamNames: Record<string, string>;
  hasEventData: boolean;
  hasRankings: boolean;
  fetchedAt: string | null;
  stale: boolean;
  /** Season rounds only: each drafted team's per-event breakdown (spec §5.5). */
  season: Record<string, SeasonTeamDetail> | null;
};

/** The one place round kinds differ when scoring (spec §5.2). Everything downstream uses the team map. */
export async function scoreSourceFor(round: RoundRow, now: Date, teamKeys: string[] = []): Promise<RoundScoreSource> {
  if (round.kind === 'season') return seasonSource(round, now, teamKeys);
  if (round.kind === 'manual') return manualSource(round);
  return tbaSource(round, now);
}

/** Season rounds (spec §5.5): only the drafted teams are scored, each over its official events. */
async function seasonSource(round: RoundRow, now: Date, teamKeys: string[]): Promise<RoundScoreSource> {
  const s = await scoreSeasonRound(round, teamKeys, now);
  return {
    teams: s.teams,
    // A season spans many events: the page's per-event notes (OPR pending, RP missing) don't apply.
    qualsComplete: true,
    rpMethod: 'none',
    teamNames: {},
    hasEventData: Object.values(s.detail).some((d) => d.events.length > 0),
    hasRankings: false,
    fetchedAt: s.fetchedAt,
    stale: s.stale,
    season: s.detail,
  };
}

/** Typed-in results (spec §5.3): never calls TBA and is never cached in event_scores. */
async function manualSource(round: RoundRow): Promise<RoundScoreSource> {
  const results = await getRepo().listManualResults(round.id);
  const scored = scoreManualEvent(results, round.scoring);
  return {
    teams: scored.teams,
    qualsComplete: scored.qualsComplete,
    rpMethod: scored.rpMethod,
    teamNames: {},
    hasEventData: results.length > 0,
    hasRankings: results.some((r) => r.qualRank !== null),
    fetchedAt: null,
    stale: false,
    season: null,
  };
}

/** Moved unchanged from SP3's buildRoundView: scores come through the event_scores cache (spec §5.6). */
async function tbaSource(round: RoundRow, now: Date): Promise<RoundScoreSource> {
  // 0005's rounds_kind_event_key: every TBA round has an event key (and no other kind does).
  const eventKey = round.eventKey;
  if (!eventKey) throw new Error(`TBA round ${round.id} has no event key`);
  // Failures degrade to empty + stale inside getEventScores.
  const event = await getEventScores(eventKey, round.scoring, cacheWindowFor(round, now), { now });
  return {
    teams: event.scores.teams,
    qualsComplete: event.scores.qualsComplete,
    rpMethod: event.scores.rpMethod,
    teamNames: event.info.teamNames,
    hasEventData: event.info.hasEventData,
    hasRankings: event.info.hasRankings,
    fetchedAt: event.fetchedAt,
    stale: event.stale,
    season: null,
  };
}
