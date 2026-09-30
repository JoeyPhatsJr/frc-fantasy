import { handle, json } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import type { AdminState } from '@/lib/api/types';
import { getRepo } from '@/lib/db';
import { roundStatus } from '@/lib/rounds/status';
import { playersInUse } from '@/lib/rounds/usage';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const repo = getRepo();
    const now = new Date();

    const [players, rounds, used] = await Promise.all([
      repo.listPlayers(league.id),
      repo.listRounds(league.id),
      playersInUse(repo, league.id),
    ]);
    const picks = await repo.listPicksForRounds(rounds.map((r) => r.id));

    const state: AdminState = {
      league: {
        slug: league.slug,
        name: league.name,
        homeTeamNumber: league.homeTeamNumber,
        defaultScoring: league.defaultScoring,
      },
      players: players.map((p) => ({
        id: p.id, name: p.name, inUse: used.has(p.id), role: p.role, linked: p.userId !== null,
      })),
      rounds: rounds.map((r) => {
        const pickCount = picks.filter((p) => p.roundId === r.id).length;
        return {
          id: r.id,
          eventKey: r.eventKey,
          eventName: r.eventName,
          startDate: r.startDate,
          endDate: r.endDate,
          status: roundStatus(r, pickCount, now),
          pickCount,
          totalPicks: r.draftOrder.length * r.rosterSize,
        };
      }),
    };
    return json(state);
  });
}
