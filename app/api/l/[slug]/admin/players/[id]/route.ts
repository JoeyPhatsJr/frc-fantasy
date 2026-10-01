import { z } from 'zod';
import { handle, HttpError, isUuid, json, noContent, parseBody } from '@/lib/api/http';
import type { AdminPlayer } from '@/lib/api/types';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import type { LeagueRow, PlayerRow } from '@/lib/db/types';
import { assertKeepsCommissioner, removeMember } from '@/lib/leagues/membership';
import { nameSchema } from '@/lib/leagues/names';
import { playersInUse } from '@/lib/rounds/usage';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string; id: string }> };

const patchSchema = z
  .strictObject({
    name: nameSchema.optional(),
    role: z.enum(['commissioner', 'player'], 'role must be commissioner or player').optional(),
  })
  .refine((v) => v.name !== undefined || v.role !== undefined, { message: 'Nothing to change' });

async function loadPlayers(league: LeagueRow, id: string): Promise<{ players: PlayerRow[]; player: PlayerRow }> {
  if (!isUuid(id)) throw new HttpError(404, 'Player not found');
  const players = await getRepo().listPlayers(league.id);
  const player = players.find((p) => p.id === id);
  if (!player) throw new HttpError(404, 'Player not found');
  return { players, player };
}

function toAdminPlayer(p: PlayerRow, used: Set<string>): AdminPlayer {
  return { id: p.id, name: p.name, inUse: used.has(p.id), role: p.role, linked: p.userId !== null };
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const { players, player } = await loadPlayers(league, id);
    const patch = await parseBody(req, patchSchema);

    if (patch.role === 'commissioner' && player.userId === null) {
      throw new HttpError(409, `${player.name} has left the league, so they can't be a commissioner`);
    }
    if (patch.role === 'player') assertKeepsCommissioner(players, player);

    const repo = getRepo();
    const saved = await repo.updatePlayer(player.id, { name: patch.name, role: patch.role });
    return json({ player: toAdminPlayer(saved, await playersInUse(repo, league.id)) });
  });
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const { players, player } = await loadPlayers(league, id);
    assertKeepsCommissioner(players, player);
    const result = await removeMember(getRepo(), player);
    return result === 'deleted' ? noContent() : json({ result });
  });
}
