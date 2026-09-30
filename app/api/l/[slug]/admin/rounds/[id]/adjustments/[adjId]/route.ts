import { z } from 'zod';
import {
  assertLeaguePlayer,
  playerIdField,
  pointsField,
  reasonField,
  teamKeyField,
  toJson,
} from '@/lib/api/adjustments';
import {
  handle,
  HttpError,
  isUuid,
  json,
  noContent,
  parseBody,
  requireRound,
} from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import type { AdjustmentRow, RoundRow } from '@/lib/db/types';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string; id: string; adjId: string }> };

const patchSchema = z
  .strictObject({
    playerId: playerIdField.optional(),
    teamKey: teamKeyField.optional(),
    points: pointsField.optional(),
    reason: reasonField.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change' })
  .refine((v) => !(v.playerId !== undefined && v.teamKey !== undefined), {
    message: 'Choose one target: a player or a team',
  });

async function requireAdjustment(round: RoundRow, adjId: string): Promise<AdjustmentRow> {
  if (!isUuid(adjId)) throw new HttpError(404, 'Adjustment not found');
  const adjustment = await getRepo().getAdjustment(adjId);
  if (!adjustment || adjustment.roundId !== round.id) throw new HttpError(404, 'Adjustment not found');
  return adjustment;
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id, adjId } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const round = await requireRound(league, id);
    const existing = await requireAdjustment(round, adjId);
    const patch = await parseBody(req, patchSchema);

    // Naming a new target clears the other one, so there is always exactly one.
    let playerId = existing.playerId;
    let teamKey = existing.teamKey;
    if (patch.playerId !== undefined) {
      await assertLeaguePlayer(league.id, patch.playerId);
      playerId = patch.playerId;
      teamKey = null;
    } else if (patch.teamKey !== undefined) {
      teamKey = patch.teamKey;
      playerId = null;
    }

    const saved = await getRepo().updateAdjustment(existing.id, {
      playerId,
      teamKey,
      points: patch.points,
      reason: patch.reason,
    });
    return json({ adjustment: toJson(saved) });
  });
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id, adjId } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const round = await requireRound(league, id);
    const existing = await requireAdjustment(round, adjId);
    await getRepo().deleteAdjustment(existing.id);
    return noContent();
  });
}
