import { z } from 'zod';
import {
  handle,
  HttpError,
  json,
  noContent,
  parseBody,
  requireRound,
} from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { afterDraftChange } from '@/lib/draft/afterChange';
import { ring } from '@/lib/realtime/doorbell';
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

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id, pickNumber } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const round = await requireRound(league, id);
    const repo = getRepo();
    const picks = await repo.listPicks(round.id);
    const n = parsePickNumber(pickNumber);
    if (n === null || picks.length === 0 || n !== picks.length - 1) {
      throw new HttpError(409, 'Only the last pick can be undone — refresh');
    }
    if (round.draftMode === 'live' && round.draftStartedAt) {
      const undone = picks[picks.length - 1];
      if (!(await repo.undoPickAtomic(round.id, n))) {
        throw new HttpError(409, 'Only the last pick can be undone — refresh');
      }
      // v2 §7.3: otherwise advance() would re-pick the same team and the undo would do nothing.
      if (undone.auto) await repo.setAutodraft(round.id, undone.playerId, false);
      await afterDraftChange(round.id, new Date());
      return noContent();
    }
    await repo.deletePick(round.id, n);
    return noContent();
  });
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id, pickNumber } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
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
    if (round.draftMode === 'live' && saved !== existing) await ring(round.id);
    return json({
      pick: { pickNumber: saved.pickNumber, playerId: saved.playerId, teamKey: saved.teamKey },
    });
  });
}
