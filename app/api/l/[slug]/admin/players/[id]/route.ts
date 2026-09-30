import { z } from 'zod';
import {
  handle,
  HttpError,
  isUuid,
  json,
  noContent,
  parseBody,
  requireCommissioner,
} from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import type { LeagueRow, PlayerRow } from '@/lib/db/types';
import { playersInUse } from '@/lib/rounds/usage';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string; id: string }> };

const bodySchema = z.object({
  name: z
    .string('Player name is required')
    .trim()
    .min(1, 'Player name is required')
    .max(40, 'Player name must be 40 characters or fewer'),
});

async function requirePlayer(league: LeagueRow, id: string): Promise<PlayerRow> {
  if (!isUuid(id)) throw new HttpError(404, 'Player not found');
  const player = (await getRepo().listPlayers(league.id)).find((p) => p.id === id);
  if (!player) throw new HttpError(404, 'Player not found');
  return player;
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const player = await requirePlayer(league, id);
    const { name } = await parseBody(req, bodySchema);
    const repo = getRepo();
    const saved = await repo.renamePlayer(player.id, name);
    const used = await playersInUse(repo, league.id);
    return json({ player: { id: saved.id, name: saved.name, inUse: used.has(saved.id) } });
  });
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const player = await requirePlayer(league, id);
    const repo = getRepo();
    const used = await playersInUse(repo, league.id);
    if (used.has(player.id)) {
      throw new HttpError(
        409,
        `${player.name} is in a draft order or has picks or adjustments, so they can't be removed. You can rename them instead.`,
      );
    }
    await repo.deletePlayer(player.id);
    return noContent();
  });
}
