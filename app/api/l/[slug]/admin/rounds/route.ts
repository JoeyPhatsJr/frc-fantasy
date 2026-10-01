import { z } from 'zod';
import { handle, HttpError, json, parseBody } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { DEFAULT_WINDOW_MS } from '@/lib/rounds/status';
import { getTba } from '@/lib/tba/client';
import type { TbaEvent } from '@/lib/tba/types';
import { normalizeEventKey } from '@/lib/teams';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MSG = 'Dates look like 2026-11-07';
/** A real calendar day. Rejects 2026-02-30, which some engines roll into March and others call Invalid Date. */
function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const date = z.string(DATE_MSG).refine(isRealDate, DATE_MSG);

const tbaBody = z.strictObject({
  kind: z.literal('tba'),
  eventKey: z.string('Event key is required').max(40, 'Event keys look like 2025parr'),
});
const manualBody = z
  .strictObject({
    kind: z.literal('manual'),
    name: z
      .string('Event name is required')
      .trim()
      .min(1, 'Event name is required')
      .max(80, 'Event name must be 80 characters or fewer'),
    startDate: date,
    endDate: date,
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'The end date must be on or after the start date' });

// v1 clients send only { eventKey }: treat a body without `kind` as a TBA round.
const bodySchema = z.preprocess(
  (v) => (typeof v === 'object' && v !== null && !Array.isArray(v) && !('kind' in v) ? { ...v, kind: 'tba' } : v),
  z.discriminatedUnion('kind', [tbaBody, manualBody]),
);

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    if (league.format === 'season') {
      throw new HttpError(409, 'Season leagues add their season rounds automatically');
    }
    const body = await parseBody(req, bodySchema);

    if (body.kind === 'manual') {
      const round = await getRepo().createRound({
        leagueId: league.id,
        kind: 'manual',
        eventKey: null,
        eventName: body.name,
        startDate: body.startDate,
        endDate: body.endDate,
        timezone: 'America/New_York',
        scoring: structuredClone(league.defaultScoring),
      });
      return json(
        { round: { id: round.id, eventKey: null, eventName: round.eventName, startDate: round.startDate, endDate: round.endDate } },
        201,
      );
    }

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
