import type { RoundRow } from '@/lib/db/types';
import { addDays, DEFAULT_WINDOW_MS, localDate } from '@/lib/rounds/status';
import { isOfficialEvent, SEASON_TIMEZONE } from '@/lib/season/calendar';
import { getTba } from '@/lib/tba/client';
import type { EventSimple } from '@/lib/tba/types';

/** Spec §4.6: the official event covering today (±1 day), else the next one within 7 days, else nothing. */
export function seasonCurrentEvent(
  events: EventSimple[],
  today: string,
): { kind: 'current'; event: EventSimple } | { kind: 'next'; event: EventSimple } | null {
  const official = events
    .filter((e) => e && isOfficialEvent(e))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const current = official.find((e) => addDays(e.start_date, -1) <= today && today <= addDays(e.end_date, 1));
  if (current) return { kind: 'current', event: current };
  const next = official.find((e) => e.start_date > today);
  return next && next.start_date <= addDays(today, 7) ? { kind: 'next', event: next } : null;
}

/** Which event the Me tab's "Live now / Up next" card should look at for one drafted team. */
export async function pickEventForMe(
  round: RoundRow,
  teamKey: string,
  now: Date,
): Promise<{ kind: 'event'; eventKey: string } | { kind: 'next'; name: string; startDate: string } | null> {
  if (round.kind === 'tba') return round.eventKey ? { kind: 'event', eventKey: round.eventKey } : null;
  if (round.kind !== 'season' || round.seasonYear === null) return null; // manual: no TBA matches to show
  const res = await getTba<EventSimple[]>(`/team/${teamKey}/events/${round.seasonYear}/simple`, {
    windowMs: DEFAULT_WINDOW_MS,
  });
  const found = seasonCurrentEvent(Array.isArray(res.data) ? res.data : [], localDate(now, SEASON_TIMEZONE));
  if (!found) return null;
  return found.kind === 'current'
    ? { kind: 'event', eventKey: found.event.key }
    : { kind: 'next', name: found.event.name, startDate: found.event.start_date };
}
