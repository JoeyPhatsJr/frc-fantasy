import { localDate } from '@/lib/rounds/status';
import type { EventSimple } from '@/lib/tba/types';

// Pure: no database or TBA imports, so client components (the create-league form) can use it.

export const SEASON_TIMEZONE = 'America/New_York';
export const DEFAULT_SEASON_ROSTER = 8;
export const MAX_SEASON_ROSTER = 15;

/** Spec §5.5: Regional, District, District Champs, Champs Division, Champs Finals, District Champs Division. */
export const OFFICIAL_EVENT_TYPES: ReadonlySet<number> = new Set([0, 1, 2, 3, 4, 5]);

export function isOfficialEvent(e: { event_type: number }): boolean {
  return OFFICIAL_EVENT_TYPES.has(e.event_type);
}

/** Current year, or next year from October on (Eastern time), spec §5.5. */
export function defaultSeasonYear(now: Date): number {
  const today = localDate(now, SEASON_TIMEZONE);
  const year = Number(today.slice(0, 4));
  return Number(today.slice(5, 7)) >= 10 ? year + 1 : year;
}

export function allowedSeasonYears(now: Date): number[] {
  const year = Number(localDate(now, SEASON_TIMEZONE).slice(0, 4));
  return [year, year + 1];
}

export function seasonRoundName(year: number): string {
  return `${year} Season`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Earliest official start to latest official end; the whole year until TBA publishes the calendar. */
export function seasonDates(events: EventSimple[] | null, year: number): { startDate: string; endDate: string } {
  const official = (events ?? []).filter(
    (e) => e && isOfficialEvent(e) && DATE_RE.test(e.start_date ?? '') && DATE_RE.test(e.end_date ?? ''),
  );
  if (official.length === 0) return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
  return {
    startDate: official.map((e) => e.start_date).sort()[0],
    endDate: official.map((e) => e.end_date).sort().at(-1)!,
  };
}
