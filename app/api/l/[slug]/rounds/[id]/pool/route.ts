import { handle, json, requireRound } from '@/lib/api/http';
import { requireLeagueView } from '@/lib/auth/roles';
import { buildPoolEntries } from '@/lib/pool/entries';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string }> };

/** Spec §6.3: the draft pool, for anyone who can view the league. */
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league } = await requireLeagueView(slug);
    const round = await requireRound(league, id);
    return json(await buildPoolEntries(round, new Date()));
  });
}
