import { localDate, MINUTE_MS } from '@/lib/rounds/status';
import { getTba } from '@/lib/tba/client';
import type { TbaEvent } from '@/lib/tba/types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The next n events that start today or later (spec §4.6 "Coming up"). */
export function pickUpcoming(events: TbaEvent[], today: string, n = 4): TbaEvent[] {
  return events
    .filter((e) => DATE_RE.test(e.start_date ?? '') && e.start_date >= today && typeof e.name === 'string')
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name))
    .slice(0, n);
}

async function eventsFor(year: number): Promise<TbaEvent[]> {
  const res = await getTba<TbaEvent[]>(`/events/${year}/simple`, { windowMs: 10 * MINUTE_MS });
  return Array.isArray(res.data) ? res.data : [];
}

/** Never throws: if TBA is unreachable the landing page just omits the block. */
export async function loadUpcomingEvents(now: Date): Promise<TbaEvent[]> {
  try {
    const today = localDate(now, 'America/New_York');
    const year = Number(today.slice(0, 4));
    let picked = pickUpcoming(await eventsFor(year), today);
    if (picked.length < 4) picked = pickUpcoming([...picked, ...(await eventsFor(year + 1))], today);
    return picked;
  } catch (err) {
    console.error(err);
    return [];
  }
}
