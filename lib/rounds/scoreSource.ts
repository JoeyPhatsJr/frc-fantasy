import { getRepo } from '@/lib/db';
import type { RoundRow } from '@/lib/db/types';
import { cacheWindowFor } from '@/lib/rounds/status';
import { getEventScores } from '@/lib/scores/eventScores';
import { scoreEvent } from '@/lib/scoring/engine';
import { scoreManualEvent } from '@/lib/scoring/manual';
import type { RpMethod, TeamScore } from '@/lib/scoring/types';
import { eventInfo, NO_EVENT_DATA } from '@/lib/tba/clean';

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
};

/** The one place round kinds differ when scoring (spec §5.2). Everything downstream uses the team map. */
export async function scoreSourceFor(round: RoundRow, now: Date): Promise<RoundScoreSource> {
  if (round.kind === 'manual') return manualSource(round);
  // Only TBA rounds have an event key (0005's rounds_kind_event_key). Season rounds score as "no data" until Task 15.
  if (!round.eventKey) return noEventSource(round);
  return tbaSource(round, round.eventKey, now);
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
  };
}

/** Moved unchanged from SP3's buildRoundView: scores come through the event_scores cache (spec §5.6). */
async function tbaSource(round: RoundRow, eventKey: string, now: Date): Promise<RoundScoreSource> {
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
  };
}

/** Moved unchanged from SP3's buildRoundView: a round with no event to read shows "no event data". */
function noEventSource(round: RoundRow): RoundScoreSource {
  const scores = scoreEvent(NO_EVENT_DATA, round.scoring);
  const info = eventInfo(NO_EVENT_DATA);
  return {
    teams: scores.teams,
    qualsComplete: scores.qualsComplete,
    rpMethod: scores.rpMethod,
    teamNames: info.teamNames,
    hasEventData: info.hasEventData,
    hasRankings: info.hasRankings,
    fetchedAt: null,
    stale: false,
  };
}
