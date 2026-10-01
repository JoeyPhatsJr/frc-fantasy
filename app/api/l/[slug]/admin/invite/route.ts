import { handle, json } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

/** Reset invite code (spec §4.4): old links and codes stop working immediately. */
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const saved = await getRepo().resetInviteCode(league.id);
    return json({ inviteCode: saved.inviteCode });
  });
}
