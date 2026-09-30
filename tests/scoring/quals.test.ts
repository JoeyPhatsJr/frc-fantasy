import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { extractRp, qualLines, qualRecords, rankTierPoints } from '@/lib/scoring/quals';
import type { RankingsResponse } from '@/lib/tba/types';
import { match, rankRow, rankings } from '../helpers/builders';

const R = ['frc1', 'frc2', 'frc3'];
const B = ['frc4', 'frc5', 'frc6'];

describe('rankTierPoints', () => {
  const tiers = DEFAULT_SCORING.rankTiers;
  it('scores the boundaries 1, 8, 9, 16, 17', () => {
    expect(rankTierPoints(1, tiers)).toBe(10);
    expect(rankTierPoints(2, tiers)).toBe(5);
    expect(rankTierPoints(8, tiers)).toBe(5);
    expect(rankTierPoints(9, tiers)).toBe(2);
    expect(rankTierPoints(16, tiers)).toBe(2);
    expect(rankTierPoints(17, tiers)).toBe(0);
  });
  it('returns 0 for no tiers or a nonsense rank', () => {
    expect(rankTierPoints(1, [])).toBe(0);
    expect(rankTierPoints(0, tiers)).toBe(0);
    expect(rankTierPoints(Number.NaN, tiers)).toBe(0);
  });
});

describe('extractRp (§7.4)', () => {
  it('branch 1: reads "Total Ranking Points" from extra_stats', () => {
    const r: RankingsResponse = {
      rankings: [rankRow(1, 'frc1', [7, 2, 0], { extra_stats: [4, 22], sort_orders: [2.44] })],
      extra_stats_info: [{ name: 'Something Else' }, { name: 'Total Ranking Points' }],
      sort_order_info: [{ name: 'Ranking Score' }],
    };
    const out = extractRp(r);
    expect(out.method).toBe('extra_stats');
    expect(out.byTeam.get('frc1')).toBe(22);
  });

  it('branch 2: multiplies the average by matches played and rounds', () => {
    const r: RankingsResponse = {
      rankings: [rankRow(1, 'frc1', [7, 2, 0], { sort_orders: [2.4444] })],
      extra_stats_info: [],
      sort_order_info: [{ name: 'Ranking Score' }],
    };
    const out = extractRp(r);
    expect(out.method).toBe('sort_order_avg');
    expect(out.byTeam.get('frc1')).toBe(22); // 2.4444 * 9 = 21.9996
  });

  it('branch 2 also matches "Ranking Points" in the sort order name', () => {
    const r: RankingsResponse = {
      rankings: [rankRow(1, 'frc1', [2, 0, 0], { sort_orders: [3] })],
      extra_stats_info: null,
      sort_order_info: [{ name: 'Avg Ranking Points' }],
    };
    expect(extractRp(r)).toMatchObject({ method: 'sort_order_avg' });
    expect(extractRp(r).byTeam.get('frc1')).toBe(6);
  });

  it('branch 3: unknown shape gives method "none" and no RP', () => {
    const r: RankingsResponse = {
      rankings: [rankRow(1, 'frc1', [2, 0, 0], { sort_orders: [55] })],
      extra_stats_info: [],
      sort_order_info: [{ name: 'Qual Average' }],
    };
    const out = extractRp(r);
    expect(out.method).toBe('none');
    expect(out.byTeam.size).toBe(0);
  });

  it('handles a null response, null arrays, and null sort_order_info', () => {
    expect(extractRp(null).method).toBe('none');
    expect(extractRp({ rankings: null }).method).toBe('none');
    const r: RankingsResponse = {
      rankings: [rankRow(1, 'frc1', [1, 0, 0])],
      extra_stats_info: null,
      sort_order_info: null,
    };
    expect(extractRp(r).method).toBe('none');
  });

  it('treats a missing number as 0 RP', () => {
    const r = rankings([rankRow(1, 'frc1', [1, 0, 0], { extra_stats: null })]);
    expect(extractRp(r).byTeam.get('frc1')).toBe(0);
  });
});

describe('qualRecords', () => {
  it('uses the record from rankings when present', () => {
    const recs = qualRecords(rankings([rankRow(1, 'frc1', [7, 2, 1])]), null);
    expect(recs.get('frc1')).toEqual({ wins: 7, losses: 2, ties: 1 });
  });

  it('falls back to matches when rankings are null', () => {
    const matches = [
      match({ num: 1, red: R, blue: B, redScore: 10, blueScore: 5 }),
      match({ num: 2, red: R, blue: B, redScore: 7, blueScore: 7 }),
      match({ num: 3, red: R, blue: B }), // unplayed, ignored
      match({ level: 'sf', set: 1, num: 1, red: R, blue: B, redScore: 1, blueScore: 9 }), // playoff, ignored
    ];
    const recs = qualRecords(null, matches);
    expect(recs.get('frc1')).toEqual({ wins: 1, losses: 0, ties: 1 });
    expect(recs.get('frc4')).toEqual({ wins: 0, losses: 1, ties: 1 });
  });

  it('falls back per team when only that team has a null record', () => {
    const r = rankings([rankRow(1, 'frc1', [5, 0, 0]), rankRow(2, 'frc4', null)]);
    const matches = [match({ num: 1, red: R, blue: B, redScore: 10, blueScore: 5 })];
    const recs = qualRecords(r, matches);
    expect(recs.get('frc1')).toEqual({ wins: 5, losses: 0, ties: 0 }); // rankings win
    expect(recs.get('frc4')).toEqual({ wins: 0, losses: 1, ties: 0 }); // from matches
  });

  it('skips surrogates and disqualified teams in the fallback', () => {
    const matches = [
      match({ num: 1, red: R, blue: B, redScore: 10, blueScore: 5, redSurrogates: ['frc1'], blueDq: ['frc4'] }),
    ];
    const recs = qualRecords(null, matches);
    expect(recs.has('frc1')).toBe(false);
    expect(recs.has('frc4')).toBe(false);
    expect(recs.get('frc2')).toEqual({ wins: 1, losses: 0, ties: 0 });
  });
});

describe('qualLines', () => {
  it('builds record, RP, and rank lines with the spec labels', () => {
    const r = rankings([rankRow(3, 'frc341', [7, 2, 0], { extra_stats: [22] })]);
    const { lines, rpMethod } = qualLines({ rankings: r, matches: null }, DEFAULT_SCORING, false);
    expect(rpMethod).toBe('extra_stats');
    expect(lines.get('frc341')).toEqual([
      { category: 'qualRecord', label: 'Qual record 7-2-0', points: 21 },
      { category: 'rankingPoints', label: 'Ranking points 22', quantity: 22, points: 22 },
      { category: 'rank', label: 'Current rank #3', quantity: 3, points: 5 },
    ]);
  });

  it('skips the rank line when the rank is missing or not a positive number', () => {
    const bad = rankRow(1, 'frc1', [2, 0, 0], { extra_stats: [4] });
    (bad as { rank: unknown }).rank = null;
    const { lines } = qualLines({ rankings: rankings([bad]), matches: null }, DEFAULT_SCORING, false);
    expect(lines.get('frc1')!.map((l) => l.category)).toEqual(['qualRecord', 'rankingPoints']);
  });

  it('says "Final rank" once quals are complete', () => {
    const r = rankings([rankRow(1, 'frc1', [9, 0, 0], { extra_stats: [30] })]);
    const { lines } = qualLines({ rankings: r, matches: null }, DEFAULT_SCORING, true);
    expect(lines.get('frc1')![2]).toEqual({ category: 'rank', label: 'Final rank #1', quantity: 1, points: 10 });
  });

  it('applies qualTie and a negative qualLoss', () => {
    const config = { ...DEFAULT_SCORING, qualLoss: -1 };
    const r = rankings([rankRow(20, 'frc9', [1, 4, 2], { extra_stats: [5] })]);
    const { lines } = qualLines({ rankings: r, matches: null }, config, false);
    expect(lines.get('frc9')![0].points).toBe(1 * 3 + 2 * 1 + 4 * -1);
  });

  // Review Focus 1
  it('gives no rank points when no matches have been played', () => {
    const r = rankings([rankRow(1, 'frc1', [0, 0, 0], { extra_stats: [0] })]);
    const { lines } = qualLines({ rankings: r, matches: null }, DEFAULT_SCORING, false);
    expect((lines.get('frc1') ?? []).filter((l) => l.category === 'rank')).toEqual([]);
  });

  it('returns nothing and never throws when everything is null', () => {
    const { lines, rpMethod } = qualLines({ rankings: null, matches: null }, DEFAULT_SCORING, false);
    expect(lines.size).toBe(0);
    expect(rpMethod).toBe('none');
  });
});
