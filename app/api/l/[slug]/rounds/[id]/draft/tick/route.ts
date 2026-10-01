import { z } from 'zod';
import { handle, json, parseBody, requireRound } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { advance } from '@/lib/draft/advance';
import { chooseAutoPick, draftPhase, onClockPlayer } from '@/lib/draft/live';
import { buildPoolEntries } from '@/lib/pool/entries';
import { ring } from '@/lib/realtime/doorbell';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string }> };

const bodySchema = z.object({
  expectedPickNumber: z
    .number('expectedPickNumber must be a whole number, 0 or more')
    .int('expectedPickNumber must be a whole number, 0 or more')
    .min(0, 'expectedPickNumber must be a whole number, 0 or more'),
});

/**
 * Spec §7.4 timeout: any member's phone calls this once its corrected clock passes deadline + 500 ms.
 * The database clock has the final say (p_require_due), so a phone with a fast clock can't cut a turn short.
 */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'player');
    const round = await requireRound(league, id);
    const { expectedPickNumber } = await parseBody(req, bodySchema);
    const repo = getRepo();
    const now = new Date();

    const picks = await repo.listPicks(round.id);
    const playerId = onClockPlayer(round, picks.length);
    if (
      draftPhase(round, picks.length) !== 'live' ||
      expectedPickNumber !== picks.length ||
      round.pickSeconds === null ||
      !round.pickDeadline ||
      !playerId
    ) {
      return json({ picked: false });
    }

    const [pool, queue] = await Promise.all([buildPoolEntries(round, now), repo.getQueue(round.id, playerId)]);
    const teamKey = chooseAutoPick(queue, pool.filter((e) => e.available));
    if (!teamKey) return json({ picked: false });

    const picked = await repo.makePickAtomic({
      roundId: round.id, pickNumber: expectedPickNumber, playerId, teamKey, requireDue: true, auto: true,
    });
    if (picked) {
      await advance(round.id, now);
      await ring(round.id);
    }
    return json({ picked });
  });
}
