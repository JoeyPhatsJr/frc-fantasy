import { z } from 'zod';
import {
  assertLeaguePlayer,
  ONE_TARGET,
  playerIdField,
  pointsField,
  reasonField,
  teamKeyField,
  toJson,
} from '@/lib/api/adjustments';
import {
  handle,
  HttpError,
  json,
  parseBody,
  requireCommissioner,
  requireRound,
} from '@/lib/api/http';
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string; id: string }> };

const bodySchema = z.strictObject({
  playerId: playerIdField.nullish(),
  teamKey: teamKeyField.nullish(),
  points: pointsField,
  reason: reasonField,
});

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const round = await requireRound(league, id);
    const body = await parseBody(req, bodySchema);

    const playerId = body.playerId ?? null;
    const teamKey = body.teamKey ?? null;
    if ((playerId === null) === (teamKey === null)) throw new HttpError(400, ONE_TARGET);
    if (playerId) await assertLeaguePlayer(league.id, playerId);

    const saved = await getRepo().insertAdjustment({
      roundId: round.id,
      playerId,
      teamKey,
      points: body.points,
      reason: body.reason,
    });
    return json({ adjustment: toJson(saved) }, 201);
  });
}
