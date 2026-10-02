import type { PickRow, RoundRow } from '@/lib/db/types';
import { localDate, roundStatus } from './status';
import { targetRound, type TargetCandidate } from './target';

/** Each round's status, counting only its own picks. Database rows only, no TBA. */
export function statusesFromRows(rounds: readonly RoundRow[], picks: readonly PickRow[], now: Date): TargetCandidate[] {
  const counts = new Map<string, number>();
  for (const p of picks) counts.set(p.roundId, (counts.get(p.roundId) ?? 0) + 1);
  return rounds.map((round) => ({
    id: round.id,
    startDate: round.startDate,
    status: roundStatus(round, counts.get(round.id) ?? 0, now),
  }));
}

/**
 * The round the Event and Draft tabs open (see targetRound), straight from database rows. "Today" is
 * the first round's local date, as before. Null when the league has no rounds.
 */
export function targetFromRows(rounds: readonly RoundRow[], picks: readonly PickRow[], now: Date): string | null {
  return targetRound(statusesFromRows(rounds, picks, now), localDate(now, rounds[0]?.timezone));
}
