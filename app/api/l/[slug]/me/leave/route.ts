import { handle, json } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { assertKeepsCommissioner, removeMember } from '@/lib/leagues/membership';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

/** Leave a league (spec §4.3): delete-or-unlink; the last commissioner can't leave. */
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const { league, player } = await requireLeagueRole(slug, 'player');
    const repo = getRepo();
    assertKeepsCommissioner(await repo.listPlayers(league.id), player);
    return json({ result: await removeMember(repo, player) });
  });
}
