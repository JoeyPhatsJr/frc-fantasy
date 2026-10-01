export type RoundTiming = {
  startDate: string; // YYYY-MM-DD
  endDate: string;
  timezone: string | null;
  finalizedAt: string | null;
};

export type RoundStatus = 'final' | 'setup' | 'drafting' | 'upcoming' | 'live' | 'awaiting_final';

export const STATUS_LABEL: Record<RoundStatus, string> = {
  setup: 'Setup',
  drafting: 'Drafting',
  upcoming: 'Upcoming',
  live: 'Live',
  awaiting_final: 'Awaiting final',
  final: 'Final',
};

export const MINUTE_MS = 60_000;
export const DEFAULT_WINDOW_MS = 10 * MINUTE_MS;

const FALLBACK_TIMEZONE = 'America/New_York';

function formatIn(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today's date (YYYY-MM-DD) where the event is. Unknown timezones fall back to Eastern. */
export function localDate(now: Date, timezone: string | null | undefined): string {
  try {
    return formatIn(now, timezone || FALLBACK_TIMEZONE);
  } catch {
    return formatIn(now, FALLBACK_TIMEZONE);
  }
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD strings compare correctly as plain strings. */
export function eventPhase(round: RoundTiming, now: Date): 'before' | 'during' | 'after' {
  const today = localDate(now, round.timezone);
  if (today < addDays(round.startDate, -1)) return 'before';
  if (today > addDays(round.endDate, 1)) return 'after';
  return 'during';
}

export function cacheWindowFor(round: RoundTiming, now: Date): number {
  if (round.finalizedAt) return 24 * 60 * MINUTE_MS;
  return eventPhase(round, now) === 'during' ? MINUTE_MS : 10 * MINUTE_MS;
}

export function roundStatus(
  round: RoundTiming & { rosterSize: number; draftOrder: string[]; draftStartedAt?: string | null },
  pickCount: number,
  now: Date,
): RoundStatus {
  if (round.finalizedAt) return 'final';
  // v2 §7.1: a started live draft shows as Drafting even before the first pick.
  if (pickCount <= 0 && !round.draftStartedAt) return 'setup';
  if (pickCount < round.draftOrder.length * round.rosterSize) return 'drafting';
  const phase = eventPhase(round, now);
  if (phase === 'before') return 'upcoming';
  if (phase === 'during') return 'live';
  return 'awaiting_final';
}

export function shouldNudgeFinalize(round: RoundTiming, now: Date): boolean {
  return !round.finalizedAt && eventPhase(round, now) === 'after';
}
