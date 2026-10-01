import { z } from 'zod';
import { handle, HttpError, json, parseBody, requireRound } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { draftPhase } from '@/lib/draft/live';
import { ring } from '@/lib/realtime/doorbell';
import { loadPool } from '@/lib/rounds/pool';
import { TEAM_KEY_RE, teamLabel } from '@/lib/teams';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string }> };

// Not exported: a route file may only export handlers and route config (Next.js build rule).
const MAX_QUEUE = 100;

const bodySchema = z.object({
  teamKeys: z
    .array(z.string().regex(TEAM_KEY_RE, 'Team keys look like frc341'), 'teamKeys must be a list of team keys')
    .max(MAX_QUEUE, `A queue can hold at most ${MAX_QUEUE} teams`)
    .refine((keys) => new Set(keys).size === keys.length, { message: 'A team can only be in your queue once' }),
});

/** Spec §7.3: replaces my whole draft queue. */
export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league, player } = await requireLeagueRole(slug, 'player');
    const round = await requireRound(league, id);
    const { teamKeys } = await parseBody(req, bodySchema);
    const repo = getRepo();

    const picks = await repo.listPicks(round.id);
    if (draftPhase(round, picks.length) === 'done') throw new HttpError(409, 'The draft is over');
    const pool = new Set((await loadPool(round, new Date())).teams.map((t) => t.teamKey));
    const outside = teamKeys.find((k) => !pool.has(k));
    if (outside) throw new HttpError(400, `${teamLabel(outside)} isn't in this event's team pool`);

    await repo.setQueue(round.id, player.id, teamKeys);
    await ring(round.id);
    return json({ queue: teamKeys });
  });
}
