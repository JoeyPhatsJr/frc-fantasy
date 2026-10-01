import { z } from 'zod';
import { handle, HttpError, json, parseBody } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { MAX_FOLLOWS } from '@/lib/follow/input';
import { syncFollowedEvents } from '@/lib/follow/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string }> };

const TEAM_MSG = 'Team numbers are 1 to 99999';
const bodySchema = z.strictObject({
  teams: z
    .array(z.number(TEAM_MSG).int(TEAM_MSG).min(1, TEAM_MSG).max(99999, TEAM_MSG), 'teams must be a list of team numbers')
    .max(MAX_FOLLOWS, `Follow at most ${MAX_FOLLOWS} teams`)
    .refine((t) => new Set(t).size === t.length, 'Each team can only be followed once'),
});

/** Replaces the league's followed teams (spec §5.4) and syncs right away so new rounds show up now. */
export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    if (league.format !== 'event') throw new HttpError(409, 'Only event-by-event leagues can follow teams');
    const { teams } = await parseBody(req, bodySchema);
    const repo = getRepo();
    await repo.setFollows(league.id, teams);
    const sync = await syncFollowedEvents(league, new Date());
    return json({ follows: await repo.listFollows(league.id), added: sync.added.length, synced: sync.ok });
  });
}
