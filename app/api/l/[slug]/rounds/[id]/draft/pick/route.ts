import { z } from 'zod';
import { handle, HttpError, json, parseBody, requireRound } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { advance } from '@/lib/draft/advance';
import { classifyFailedPick, draftError } from '@/lib/draft/errors';
import { draftPhase, onClockPlayer } from '@/lib/draft/live';
import { ring } from '@/lib/realtime/doorbell';
import { loadPool } from '@/lib/rounds/pool';
import { TEAM_KEY_RE } from '@/lib/teams';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string }> };

const bodySchema = z.object({
  expectedPickNumber: z
    .number('expectedPickNumber must be a whole number, 0 or more')
    .int('expectedPickNumber must be a whole number, 0 or more')
    .min(0, 'expectedPickNumber must be a whole number, 0 or more'),
  teamKey: z.string('teamKey is required').regex(TEAM_KEY_RE, 'Team keys look like frc341'),
});

/** Spec §7.3: a member makes their own pick in a live draft. */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league, player } = await requireLeagueRole(slug, 'player');
    const round = await requireRound(league, id);
    const { expectedPickNumber, teamKey } = await parseBody(req, bodySchema);
    const repo = getRepo();
    const now = new Date();

    const picks = await repo.listPicks(round.id);
    if (draftPhase(round, picks.length) !== 'live') throw draftError('not_live');
    if (expectedPickNumber !== picks.length) throw draftError('stale');
    if (onClockPlayer(round, picks.length) !== player.id) throw draftError('not_your_turn');
    const pool = await loadPool(round, now);
    if (!pool.teams.some((t) => t.teamKey === teamKey)) {
      throw new HttpError(400, "That team isn't in this event's team pool");
    }
    if (picks.some((p) => p.teamKey === teamKey)) throw draftError('taken');

    const ok = await repo.makePickAtomic({
      roundId: round.id, pickNumber: expectedPickNumber, playerId: player.id, teamKey, requireDue: false, auto: false,
    });
    if (!ok) throw await classifyFailedPick(round.id, teamKey);

    await advance(round.id, now);
    await ring(round.id);
    return json({ pick: { pickNumber: expectedPickNumber, playerId: player.id, teamKey } }, 201);
  });
}
