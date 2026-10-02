import { getRepo } from '@/lib/db';
import { draftPhase, onClockPlayer } from '@/lib/draft/live';
import { listMyLeagues } from '@/lib/views/memberships';

export type MyLiveDraft = {
  leagueSlug: string;
  leagueName: string;
  roundId: string;
  eventName: string;
  phase: 'live' | 'paused';
  myTurn: boolean;
};

/** Every running draft in the user's leagues, database only (spec §5.5). */
export async function loadMyLiveDrafts(userId: string): Promise<MyLiveDraft[]> {
  const repo = getRepo();
  const memberships = await listMyLeagues(userId);
  const perLeague = await Promise.all(
    memberships.map(async ({ league, player }) => {
      const rounds = (await repo.listRounds(league.id)).filter((r) => r.draftMode === 'live' && r.draftStartedAt);
      if (rounds.length === 0) return [];
      const picks = await repo.listPicksForRounds(rounds.map((r) => r.id));
      return rounds.flatMap((round): MyLiveDraft[] => {
        const count = picks.filter((p) => p.roundId === round.id).length;
        const phase = draftPhase(round, count);
        if (phase !== 'live' && phase !== 'paused') return [];
        return [
          {
            leagueSlug: league.slug,
            leagueName: league.name,
            roundId: round.id,
            eventName: round.eventName,
            phase,
            myTurn: phase === 'live' && onClockPlayer(round, count) === player.id,
          },
        ];
      });
    }),
  );
  return perLeague
    .flat()
    .sort((a, b) => Number(b.myTurn) - Number(a.myTurn) || a.leagueName.localeCompare(b.leagueName));
}

/** For the root layout: a sleeping database means no pill, never a blank page. */
export async function safeLiveDrafts(userId: string): Promise<MyLiveDraft[]> {
  try {
    return await loadMyLiveDrafts(userId);
  } catch (err) {
    console.error(err);
    return [];
  }
}
