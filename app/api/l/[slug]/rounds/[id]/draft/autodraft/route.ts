import { z } from 'zod';
import { handle, json, parseBody, requireRound } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { afterDraftChange } from '@/lib/draft/afterChange';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string }> };

const bodySchema = z.object({ on: z.boolean('on must be true or false') });

/** Spec §7.3 "Auto-draft for me". Turning it on while on the clock picks right away (§7.4). */
export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league, player } = await requireLeagueRole(slug, 'player');
    const round = await requireRound(league, id);
    const { on } = await parseBody(req, bodySchema);

    await getRepo().setAutodraft(round.id, player.id, on);
    const picked = await afterDraftChange(round.id, new Date(), { advance: on });
    return json({ autodraft: on, picked });
  });
}
