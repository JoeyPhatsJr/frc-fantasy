import { isUuid } from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import { withPublicNames } from '@/lib/leagues/names';
import type { AdjustmentRow, PickRow, PlayerRow, RoundRow } from '@/lib/db/types';
import { cacheWindowFor, roundStatus, type RoundStatus } from '@/lib/rounds/status';
import { scoreEvent } from '@/lib/scoring/engine';
import { roundPlayers, scoreRound } from '@/lib/scoring/round';
import type { PlayerRoundScore, RpMethod } from '@/lib/scoring/types';
import { getEventScores, type EventScoresResult } from '@/lib/scores/eventScores';
import { eventInfo, NO_EVENT_DATA } from '@/lib/tba/clean';

// Kept so existing imports (tests/views/views.test.ts) keep working.
export { cleanEventData } from '@/lib/tba/clean';

export type RoundView = {
  round: RoundRow;
  status: RoundStatus;
  /** One row per player in the round, already sorted and ranked. */
  scores: PlayerRoundScore[];
  picks: PickRow[];
  adjustments: AdjustmentRow[];
  /** teamKey -> nickname, for teams TBA knows about. */
  teamNames: Record<string, string>;
  qualsComplete: boolean;
  rpMethod: RpMethod;
  /** False until TBA has at least one match or ranking for the event. */
  hasEventData: boolean;
  hasRankings: boolean;
  fetchedAt: string | null;
  stale: boolean;
};

export type RoundPage = {
  league: { slug: string; name: string };
  view: RoundView;
  /** Every player in the league: id -> name ("Mom (left)" for former members). */
  playerNames: Record<string, string>;
};

export async function buildRoundView(
  round: RoundRow,
  allPlayers: PlayerRow[],
  picks: PickRow[],
  adjustments: AdjustmentRow[],
  now: Date,
): Promise<RoundView> {
  // Scores come through the derived event_scores cache (spec §5.6); failures degrade to empty + stale inside it.
  // Manual and season rounds have no TBA event yet: they take the "no event data" path (Task 5 adds scoreSourceFor).
  const event: EventScoresResult =
    round.kind === 'tba' && round.eventKey
      ? await getEventScores(round.eventKey, round.scoring, cacheWindowFor(round, now), { now })
      : {
          scores: scoreEvent(NO_EVENT_DATA, round.scoring),
          info: eventInfo(NO_EVENT_DATA),
          stale: false,
          fetchedAt: null,
        };
  const players = roundPlayers(allPlayers, round.draftOrder, adjustments);
  return {
    round,
    status: roundStatus(round, picks.length, now),
    scores: scoreRound(event.scores.teams, picks, adjustments, players),
    picks,
    adjustments,
    teamNames: event.info.teamNames,
    qualsComplete: event.scores.qualsComplete,
    rpMethod: event.scores.rpMethod,
    hasEventData: event.info.hasEventData,
    hasRankings: event.info.hasRankings,
    fetchedAt: event.fetchedAt,
    stale: event.stale,
  };
}

export async function loadRoundPage(slug: string, roundId: string, now: Date): Promise<RoundPage | null> {
  if (!isUuid(roundId)) return null;
  const repo = getRepo();
  const league = await repo.getLeagueBySlug(slug);
  if (!league) return null;
  const round = await repo.getRound(roundId);
  if (!round || round.leagueId !== league.id) return null;

  const [rows, picks, adjustments] = await Promise.all([
    repo.listPlayers(league.id),
    repo.listPicks(round.id),
    repo.listAdjustments(round.id),
  ]);
  const allPlayers = withPublicNames(rows);
  return {
    league: { slug: league.slug, name: league.name },
    view: await buildRoundView(round, allPlayers, picks, adjustments, now),
    playerNames: Object.fromEntries(allPlayers.map((p) => [p.id, p.name])),
  };
}
