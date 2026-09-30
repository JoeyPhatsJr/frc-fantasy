import { z } from 'zod';
import {
  handle,
  HttpError,
  json,
  noContent,
  parseBody,
  requireCommissioner,
  requireRound,
} from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import { loadPool } from '@/lib/rounds/pool';
import { TEAM_KEY_RE } from '@/lib/teams';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string; pickNumber: string }> };

const bodySchema = z.object({
  teamKey: z.string('teamKey is required').regex(TEAM_KEY_RE, 'Team keys look like frc341'),
});

/** "7" -> 7. Anything that isn't a plain whole number -> null. */
function parsePickNumber(raw: string): number | null {
  return /^(0|[1-9][0-9]{0,4})$/.test(raw) ? Number(raw) : null;
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id, pickNumber } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const round = await requireRound(league, id);
    const repo = getRepo();
    const picks = await repo.listPicks(round.id);
    const n = parsePickNumber(pickNumber);
    if (n === null || picks.length === 0 || n !== picks.length - 1) {
      throw new HttpError(409, 'Only the last pick can be undone — refresh');
    }
    await repo.deletePick(round.id, n);
    return noContent();
  });
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id, pickNumber } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const round = await requireRound(league, id);
    const { teamKey } = await parseBody(req, bodySchema);
    const repo = getRepo();

    const n = parsePickNumber(pickNumber);
    const existing = n === null ? undefined : (await repo.listPicks(round.id)).find((p) => p.pickNumber === n);
    if (n === null || !existing) throw new HttpError(404, 'Pick not found');

    const pool = await loadPool(round, new Date());
    if (!pool.teams.some((t) => t.teamKey === teamKey)) {
      throw new HttpError(400, "That team isn't in this event's team pool");
    }

    const saved =
      existing.teamKey === teamKey ? existing : await repo.updatePickTeam(round.id, n, teamKey);
    return json({
      pick: { pickNumber: saved.pickNumber, playerId: saved.playerId, teamKey: saved.teamKey },
    });
  });
}
