import type { RoundStatus } from './status';

export type TargetCandidate = { id: string; startDate: string; status: RoundStatus };

const PENDING: ReadonlySet<RoundStatus> = new Set(['setup', 'drafting', 'upcoming']);

const byStart = (a: TargetCandidate, b: TargetCandidate) => a.startDate.localeCompare(b.startDate);

/**
 * The round the "Round" tab opens: the live one; else the next round still being set up, drafted or
 * waiting to start (soonest from today, or the most recent if all of them are in the past); else the
 * latest round by date. Null when the league has no rounds. `today` is YYYY-MM-DD.
 */
export function targetRound(rounds: readonly TargetCandidate[], today: string): string | null {
  if (rounds.length === 0) return null;
  const sorted = [...rounds].sort(byStart);

  const live = sorted.find((r) => r.status === 'live');
  if (live) return live.id;

  const pending = sorted.filter((r) => PENDING.has(r.status));
  const nextUp = pending.find((r) => r.startDate >= today);
  if (nextUp) return nextUp.id;
  if (pending.length > 0) return pending[pending.length - 1].id;

  return sorted[sorted.length - 1].id;
}
