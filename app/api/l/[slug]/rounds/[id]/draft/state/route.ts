import { handle, json, requireRound } from '@/lib/api/http';
import { requireLeagueView } from '@/lib/auth/roles';
import { loadDraftState } from '@/lib/draft/state';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league, player } = await requireLeagueView(slug);
    const round = await requireRound(league, id);
    return json(await loadDraftState(round, player, new Date()));
  });
}
