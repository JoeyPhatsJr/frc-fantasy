import { handle, json } from '@/lib/api/http';
import { getUser } from '@/lib/auth/session';
import { buildInvitePreview, leagueForCode } from '@/lib/leagues/invites';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ code: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { code } = await ctx.params;
    const league = await leagueForCode(code);
    const user = await getUser();
    return json(await buildInvitePreview(league, user?.id ?? null));
  });
}
