import type { BestFinish } from '@/lib/db/types';

/** Spec §6.3: a projection to one decimal, or "New" when the team has no results in Y or Y−1. */
export function formatProj(proj: number | null): string {
  return proj === null ? 'New' : proj.toFixed(1);
}

/** Qualification W-L-T, e.g. "12-4-0". */
export function formatRecord(record: [number, number, number] | null): string {
  return record ? `${record[0]}-${record[1]}-${record[2]}` : '—';
}

/** Latest OPR and rank, e.g. "OPR 41.2 · #3"; either half drops out when missing. */
export function formatOprRank(opr: number | null, rank: number | null): string {
  const parts = [opr === null ? null : `OPR ${opr.toFixed(1)}`, rank === null ? null : `#${rank}`].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export const BEST_FINISH_LABEL: Record<BestFinish, string> = {
  winner: 'Event winner',
  finalist: 'Finalist',
  captain: 'Captain',
  picked: 'Picked',
};

/** Spec §6.3. SP4's PoolList test already checks this wording. */
export const POOL_FOOTNOTE = 'Proj. uses standard scoring.';
