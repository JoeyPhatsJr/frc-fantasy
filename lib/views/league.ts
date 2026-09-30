import { getRepo } from '@/lib/db';
import { seasonStandings } from '@/lib/scoring/round';
import type { SeasonRow } from '@/lib/scoring/types';
import { buildRoundView, type RoundView } from '@/lib/views/round';

export type LeaguePage = {
  league: { slug: string; name: string };
  standings: SeasonRow[];
  /** In date order. */
  rounds: RoundView[];
  anyLive: boolean;
  /** The oldest fetch among the rounds people are watching (live, else unfinished, else all). */
  fetchedAt: string | null;
  stale: boolean;
};

export async function loadLeaguePage(slug: string, now: Date): Promise<LeaguePage | null> {
  const repo = getRepo();
  const league = await repo.getLeagueBySlug(slug);
  if (!league) return null;

  const [players, rounds] = await Promise.all([repo.listPlayers(league.id), repo.listRounds(league.id)]);
  const roundIds = rounds.map((r) => r.id);
  const [picks, adjustments] = await Promise.all([
    repo.listPicksForRounds(roundIds),
    repo.listAdjustmentsForRounds(roundIds),
  ]);

  const views = await Promise.all(
    rounds.map((round) =>
      buildRoundView(
        round,
        players,
        picks.filter((p) => p.roundId === round.id),
        adjustments.filter((a) => a.roundId === round.id),
        now,
      ),
    ),
  );

  // A finalized round sits on a 24 h cache window; it must not drag "last updated" back on event day.
  const live = views.filter((v) => v.status === 'live');
  const unfinished = views.filter((v) => v.status !== 'final');
  const relevant = live.length > 0 ? live : unfinished.length > 0 ? unfinished : views;
  const times = relevant.map((v) => v.fetchedAt).filter((t): t is string => t !== null);
  return {
    league: { slug: league.slug, name: league.name },
    standings: seasonStandings(players, views.map((v) => v.scores)),
    rounds: views,
    anyLive: views.some((v) => v.status === 'live'),
    fetchedAt: times.length > 0 ? times.sort()[0] : null,
    stale: relevant.some((v) => v.stale),
  };
}
