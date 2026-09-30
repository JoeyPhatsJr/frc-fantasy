import { handle, json, requireCommissioner, requireRound } from '@/lib/api/http';
import { cacheWindowFor } from '@/lib/rounds/status';
import { loadEventData } from '@/lib/tba/event';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const round = await requireRound(league, id);
    // getTba ignores force for rows under 15 s old, which is the rate limit (spec §8.3).
    const loaded = await loadEventData(round.eventKey, {
      windowMs: cacheWindowFor(round, new Date()),
      force: true,
    });
    return json({ fetchedAt: loaded.fetchedAt, stale: loaded.stale });
  });
}
