import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING, defaultScoring, scoringConfigSchema } from '@/lib/scoring/config';

describe('scoringConfigSchema', () => {
  it('accepts the defaults', () => {
    expect(scoringConfigSchema.safeParse(DEFAULT_SCORING).success).toBe(true);
  });

  it('has the spec defaults (§6.2)', () => {
    expect(DEFAULT_SCORING.qualWin).toBe(3);
    expect(DEFAULT_SCORING.rankTiers).toEqual([
      { maxRank: 1, points: 10 },
      { maxRank: 8, points: 5 },
      { maxRank: 16, points: 2 },
    ]);
    expect(DEFAULT_SCORING.alliance).toEqual({ captain: 8, pick1: 6, pick2: 3, pick3: 2, backup: 2 });
    expect(DEFAULT_SCORING.awards.excludedTypes).toEqual([1, 2, 3, 4, 5, 6, 7, 14, 39]);
    expect(DEFAULT_SCORING.oprBonus).toEqual([6, 4, 2]);
  });

  it('rejects non-integer and out-of-range points', () => {
    expect(scoringConfigSchema.safeParse({ ...DEFAULT_SCORING, qualWin: 1.5 }).success).toBe(false);
    expect(scoringConfigSchema.safeParse({ ...DEFAULT_SCORING, qualWin: 1001 }).success).toBe(false);
    expect(scoringConfigSchema.safeParse({ ...DEFAULT_SCORING, qualLoss: -1000 }).success).toBe(true);
  });

  it('rejects rank tiers that are not strictly ascending', () => {
    const bad = { ...DEFAULT_SCORING, rankTiers: [{ maxRank: 8, points: 5 }, { maxRank: 8, points: 2 }] };
    expect(scoringConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('allows oprBonus length 0 to 10 only', () => {
    expect(scoringConfigSchema.safeParse({ ...DEFAULT_SCORING, oprBonus: [] }).success).toBe(true);
    expect(scoringConfigSchema.safeParse({ ...DEFAULT_SCORING, oprBonus: Array(11).fill(1) }).success).toBe(false);
  });

  it('rejects a wrong version', () => {
    expect(scoringConfigSchema.safeParse({ ...DEFAULT_SCORING, version: 2 }).success).toBe(false);
  });

  it('defaultScoring returns an independent copy', () => {
    const copy = defaultScoring();
    copy.rankTiers[0].points = 99;
    expect(DEFAULT_SCORING.rankTiers[0].points).toBe(10);
  });
});
