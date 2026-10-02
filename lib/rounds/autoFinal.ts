import type { RoundKind } from '@/lib/db/types';
import { addDays, localDate } from '@/lib/rounds/status';

/** Spec 2026-10-02 §4: any round is finalized this many days after its event ends. */
export const BACKSTOP_DAYS = 3;

export type AutoFinalInput = {
  kind: RoundKind;
  endDate: string;
  timezone: string | null;
  finalizedAt: string | null;
  autoFinalize: boolean;
  draftComplete: boolean;
};
export type AutoFinalDecision = 'finalize' | 'needs-finals-check' | 'wait';

export function draftComplete(round: { draftOrder: string[]; rosterSize: number }, pickCount: number): boolean {
  const total = round.draftOrder.length * round.rosterSize;
  return total > 0 && pickCount >= total;
}

/**
 * What the daily job should do with one round (spec 2026-10-02 §4). 'needs-finals-check' means a TBA
 * round on or after the day after its event: finalize it only if TBA shows the finals decided.
 */
export function autoFinalDecision(r: AutoFinalInput, now: Date): AutoFinalDecision {
  if (r.finalizedAt || !r.autoFinalize || !r.draftComplete) return 'wait';
  const today = localDate(now, r.timezone);
  if (today >= addDays(r.endDate, BACKSTOP_DAYS)) return 'finalize';
  if (r.kind === 'tba' && today > r.endDate) return 'needs-finals-check';
  return 'wait';
}
