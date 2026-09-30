import { z } from 'zod';
import { handle, HttpError, json, parseBody, requireCommissioner } from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import { DEFAULT_WINDOW_MS } from '@/lib/rounds/status';
import { getTba } from '@/lib/tba/client';
import type { TbaEvent } from '@/lib/tba/types';
import { normalizeEventKey } from '@/lib/teams';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string }> };

const bodySchema = z.object({
  eventKey: z.string('Event key is required').max(40, 'Event keys look like 2025parr'),
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const body = await parseBody(req, bodySchema);
    const eventKey = normalizeEventKey(body.eventKey);
    if (!eventKey) throw new HttpError(400, 'Event keys look like 2025parr');

    const tba = await getTba<TbaEvent>(`/event/${eventKey}`, { windowMs: DEFAULT_WINDOW_MS });
    const event = tba.data;
    if (!event) {
      if (tba.stale) throw new HttpError(503, "Couldn't reach The Blue Alliance. Try again in a minute.");
      throw new HttpError(404, `The Blue Alliance has no event with the key ${eventKey}`);
    }
    if (!event.name || !DATE_RE.test(event.start_date ?? '') || !DATE_RE.test(event.end_date ?? '')) {
      throw new HttpError(404, `The Blue Alliance has no usable event with the key ${eventKey}`);
    }

    const round = await getRepo().createRound({
      leagueId: league.id,
      eventKey,
      eventName: event.name.slice(0, 200),
      startDate: event.start_date,
      endDate: event.end_date,
      timezone: event.timezone || 'America/New_York',
      scoring: structuredClone(league.defaultScoring), // a copy: later league edits don't touch this round
    });
    return json(
      {
        round: {
          id: round.id,
          eventKey: round.eventKey,
          eventName: round.eventName,
          startDate: round.startDate,
          endDate: round.endDate,
        },
      },
      201,
    );
  });
}
