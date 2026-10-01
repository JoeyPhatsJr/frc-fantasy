import { describe, expect, it } from 'vitest';
import { filterSortPool } from '@/lib/draft/poolView';
import type { PoolEntry } from '@/lib/pool/entries';

const e = (teamKey: string, nickname: string, proj: number | null, opr: number | null = null): PoolEntry => ({
  teamKey, nickname, proj, opr, record: null, bestFinish: null, rank: null, available: true,
});
const pool = [e('frc341', 'Miss Daisy', 38.2, 40), e('frc5181', 'Explorer Robotics', null, 12), e('frc25', 'Raider Robotix', 41, null), e('frc3419', 'RoHAWKtics', 20, 55)];
const keys = (list: PoolEntry[]) => list.map((x) => x.teamKey);
const opts = { query: '', sort: 'proj' as const, availableOnly: true, taken: new Set<string>() };

describe('filterSortPool (§6.3)', () => {
  it('sorts by projection with New teams last', () => {
    expect(keys(filterSortPool(pool, opts))).toEqual(['frc25', 'frc341', 'frc3419', 'frc5181']);
  });
  it('sorts by OPR (missing last) and by team number', () => {
    expect(keys(filterSortPool(pool, { ...opts, sort: 'opr' }))).toEqual(['frc3419', 'frc341', 'frc5181', 'frc25']);
    expect(keys(filterSortPool(pool, { ...opts, sort: 'number' }))).toEqual(['frc25', 'frc341', 'frc3419', 'frc5181']);
  });
  it('searches by number prefix or nickname, case-insensitively', () => {
    expect(keys(filterSortPool(pool, { ...opts, query: '341' }))).toEqual(['frc341', 'frc3419']);
    expect(keys(filterSortPool(pool, { ...opts, query: 'robotics' }))).toEqual(['frc5181']);
    expect(keys(filterSortPool(pool, { ...opts, query: ' ROBOT ' }))).toEqual(['frc25', 'frc5181']);
  });
  it('hides taken teams unless "Available only" is off', () => {
    const taken = new Set(['frc25']);
    expect(keys(filterSortPool(pool, { ...opts, taken }))).not.toContain('frc25');
    const all = filterSortPool(pool, { ...opts, taken, availableOnly: false });
    expect(all.find((x) => x.teamKey === 'frc25')?.available).toBe(false);
  });
});
