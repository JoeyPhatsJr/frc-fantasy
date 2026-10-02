import { describe, expect, it } from 'vitest';
import { BEST_FINISH_LABEL, formatOprRank, formatProj, formatRecord, POOL_FOOTNOTE } from '@/lib/pool/format';

describe('pool formatters', () => {
  it('formats proj, record, and OPR/rank', () => {
    expect(formatProj(38.2)).toBe('38.2');
    expect(formatProj(40)).toBe('40.0');
    expect(formatProj(null)).toBe('New');
    expect(formatRecord([12, 4, 0])).toBe('12-4-0');
    expect(formatRecord(null)).toBe('—');
    expect(formatOprRank(41.23, 3)).toBe('OPR 41.2 · #3');
    expect(formatOprRank(41.2, null)).toBe('OPR 41.2');
    expect(formatOprRank(null, 7)).toBe('#7');
    expect(formatOprRank(null, null)).toBe('—');
    expect(formatOprRank(41.23, 3, 'Robot rating (OPR)')).toBe('Robot rating (OPR) 41.2 · #3');
  });

  it("labels every best finish and keeps SP4's footnote wording", () => {
    expect(BEST_FINISH_LABEL).toEqual({ winner: 'Event winner', finalist: 'Finalist', captain: 'Captain', picked: 'Picked' });
    expect(POOL_FOOTNOTE).toBe('Projected points use standard scoring.');
  });
});
