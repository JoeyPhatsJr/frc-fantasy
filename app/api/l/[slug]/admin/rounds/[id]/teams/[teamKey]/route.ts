import { handle, HttpError, noContent, requireCommissioner, requireRound } from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import { isTeamKey } from '@/lib/teams';

export const dynamic = 'force-dynamic';

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
    await repo.removeExtraTeam(round.id, teamKey);
    return noContent();
  });
}
