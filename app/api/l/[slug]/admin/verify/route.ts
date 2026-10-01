import { handle, json } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    await requireLeagueRole(slug, 'commissioner');
    return json({ ok: true });
  });
}
