import { handle, HttpError, json } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import type { EventLookup } from '@/lib/api/types';
import { getRepo } from '@/lib/db';
import { DEFAULT_WINDOW_MS } from '@/lib/rounds/status';
import { getTba } from '@/lib/tba/client';
import type { TbaEvent } from '@/lib/tba/types';
import { normalizeEventKey } from '@/lib/teams';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; eventKey: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Looks an event up on TBA without adding it (spec §5.4: "shows event name/dates for confirmation").
 * "Not found" is a normal answer (200), because a new event often isn't on TBA until a few days before.
 */
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, eventKey: rawKey } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const eventKey = normalizeEventKey(rawKey);
    if (!eventKey) throw new HttpError(400, 'Event keys look like 2025parr');

    const tba = await getTba<TbaEvent>(`/event/${eventKey}`, { windowMs: DEFAULT_WINDOW_MS });
    const event = tba.data;
    if (!event) {
      if (tba.stale) throw new HttpError(503, "Couldn't reach The Blue Alliance. Try again in a minute.");
      return json({ found: false, eventKey } satisfies EventLookup);
    }
    // Same bar as POST /rounds: an event it would refuse to add is "not found" here, so Add never 404s.
    if (!event.name || !DATE_RE.test(event.start_date ?? '') || !DATE_RE.test(event.end_date ?? '')) {
      return json({ found: false, eventKey } satisfies EventLookup);
    }

    const rounds = await getRepo().listRounds(league.id);
    const body: EventLookup = {
      found: true,
      eventKey,
      name: event.name.slice(0, 200),
      startDate: event.start_date,
      endDate: event.end_date,
      alreadyInLeague: rounds.some((r) => r.eventKey === eventKey),
    };
    return json(body);
  });
}
