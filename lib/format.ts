import type { RoundKind } from '@/lib/db/types';
import { teamLabel } from '@/lib/teams';

export function agoLabel(fetchedAt: string | null, now: Date): string {
  if (!fetchedAt) return 'never';
  const then = Date.parse(fetchedAt);
  if (Number.isNaN(then)) return 'never';
  const seconds = Math.floor((now.getTime() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export function freshnessText(fetchedAt: string | null, stale: boolean, now: Date): string {
  if (!fetchedAt) {
    return stale ? "Couldn't reach The Blue Alliance yet" : 'No data from The Blue Alliance yet';
  }
  const ago = agoLabel(fetchedAt, now);
  return stale ? `Scores may be behind — last updated ${ago}` : `Last updated ${ago}`;
}

function parts(date: string): { month: string; day: number; year: number } {
  const d = new Date(`${date}T00:00:00Z`);
  return {
    month: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
    day: d.getUTCDate(),
    year: d.getUTCFullYear(),
  };
}

export function formatDateRange(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  if (start === end) return `${a.month} ${a.day}, ${a.year}`;
  if (a.year !== b.year) return `${a.month} ${a.day}, ${a.year} – ${b.month} ${b.day}, ${b.year}`;
  if (a.month !== b.month) return `${a.month} ${a.day} – ${b.month} ${b.day}, ${a.year}`;
  return `${a.month} ${a.day}–${b.day}, ${a.year}`;
}

export function signed(n: number): string {
  return n < 0 ? `${n}` : `+${n}`;
}

export function lineText(line: { label: string; points: number }): string {
  return `${line.label} → ${signed(line.points)}`;
}

export function teamName(teamKey: string, names: Record<string, string>): string {
  const nickname = names[teamKey];
  return nickname ? `${teamLabel(teamKey)} ${nickname}` : teamLabel(teamKey);
}

export function tbaEventUrl(eventKey: string): string {
  return `https://www.thebluealliance.com/event/${eventKey}`;
}

/** The line under a round's dates: its TBA event key, or what kind of round it is when it has none. */
export function roundKeyLine(round: { eventKey: string | null; kind: RoundKind; seasonYear: number | null }): string {
  return round.eventKey ?? (round.kind === 'manual' ? 'Manual event' : `${round.seasonYear} season`);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' → 'Oct 24', read as a calendar date (no timezone shift). */
export function shortDate(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}
