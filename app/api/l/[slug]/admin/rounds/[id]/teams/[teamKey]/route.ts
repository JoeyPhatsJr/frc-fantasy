import { handle, HttpError, noContent, requireCommissioner, requireRound } from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import { loadPool } from '@/lib/rounds/pool';
import { isTeamKey } from '@/lib/teams';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // loadPool may call TBA

type Ctx = { params: Promise<{ slug: string; id: string; teamKey: string }> };

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id, teamKey } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const round = await requireRound(league, id);
    if (!isTeamKey(teamKey)) throw new HttpError(400, 'That is not a team key');
    const repo = getRepo();
    const picks = await repo.listPicks(round.id);
    if (picks.some((p) => p.teamKey === teamKey)) {
      throw new HttpError(409, 'That team has been drafted. Undo or replace the pick first.');
    }
    const P = round.draftOrder.length;
    if (P > 0) {
      const pool = await loadPool(round, new Date());
      const inPool = pool.teams.some((t) => t.teamKey === teamKey);
      if (inPool && P * round.rosterSize > pool.teams.length - 1) {
        throw new HttpError(
          409,
          `Removing this team would leave ${pool.teams.length - 1} teams for ${P * round.rosterSize} picks. Lower the roster size first.`,
        );
      }
    }
    await repo.removeExtraTeam(round.id, teamKey);
    return noContent();
  });
}
