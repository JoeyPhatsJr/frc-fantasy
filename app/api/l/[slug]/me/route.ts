import { z } from 'zod';
import { handle, json, parseBody } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { nameSchema } from '@/lib/leagues/names';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

const bodySchema = z.object({ name: nameSchema });

/** A member renames themselves in this league (spec §4.3). A clash → 409 from the unique index. */
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const { player } = await requireLeagueRole(slug, 'player');
    const { name } = await parseBody(req, bodySchema);
    const saved = await getRepo().updatePlayer(player.id, { name });
    return json({ player: { id: saved.id, name: saved.name } });
  });
}
