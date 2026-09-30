import { z } from 'zod';
import { handle, json, parseBody, requireCommissioner } from '@/lib/api/http';
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

const bodySchema = z.object({
  name: z
    .string('Player name is required')
    .trim()
    .min(1, 'Player name is required')
    .max(40, 'Player name must be 40 characters or fewer'),
});

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const { name } = await parseBody(req, bodySchema);
    const player = await getRepo().createPlayer(league.id, name);
    return json({ player: { id: player.id, name: player.name, inUse: false } }, 201);
  });
}
