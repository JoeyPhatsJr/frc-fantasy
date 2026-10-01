import { isUuid } from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import { withPublicNames } from '@/lib/leagues/names';
import type { AdjustmentRow, PickRow, PlayerRow, RoundRow } from '@/lib/db/types';
import { cacheWindowFor, roundStatus, type RoundStatus } from '@/lib/rounds/status';
import { scoreEvent } from '@/lib/scoring/engine';
import { roundPlayers, scoreRound } from '@/lib/scoring/round';
import type { PlayerRoundScore, RpMethod } from '@/lib/scoring/types';
import { loadEventData } from '@/lib/tba/event';
import { cleanEventData, NO_EVENT_DATA } from '@/lib/tba/clean';

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
  const loaded = await loadEventData(round.eventKey, { windowMs: cacheWindowFor(round, now) });
  const data = cleanEventData(loaded.data);
  let event: ReturnType<typeof scoreEvent>;
  let scoringFailed = false;
  try {
    event = scoreEvent(data, round.scoring);
  } catch (err) {
    // One malformed payload must not take the whole page (or the league page) down.
    console.error(`Scoring failed for ${round.eventKey}; falling back to empty data`, err);
    scoringFailed = true;
    event = scoreEvent(NO_EVENT_DATA, round.scoring);
  }
  const players = roundPlayers(allPlayers, round.draftOrder, adjustments);

  const teamNames: Record<string, string> = {};
  for (const t of data.teams ?? []) if (t.nickname) teamNames[t.key] = t.nickname;

  const rankingCount = Array.isArray(data.rankings?.rankings) ? data.rankings.rankings.length : 0;
  return {
    round,
    status: roundStatus(round, picks.length, now),
    scores: scoreRound(event.teams, picks, adjustments, players),
    picks,
    adjustments,
    teamNames,
    qualsComplete: event.qualsComplete,
    rpMethod: event.rpMethod,
    hasEventData: (data.matches?.length ?? 0) > 0 || rankingCount > 0,
    hasRankings: rankingCount > 0,
    fetchedAt: loaded.fetchedAt,
    stale: loaded.stale || scoringFailed,
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
