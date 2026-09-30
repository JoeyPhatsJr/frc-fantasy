import { describe, expect, it } from 'vitest';
import { isTeamKey, mergePool, normalizeEventKey, parseTeamInput, teamLabel } from '@/lib/teams';

describe('parseTeamInput', () => {
  it('accepts plain numbers', () => {
    expect(parseTeamInput('341')).toBe('frc341');
    expect(parseTeamInput('10157')).toBe('frc10157');
  });

  it('uppercases a letter suffix', () => {
    expect(parseTeamInput('341b')).toBe('frc341B');
  });

  // Review Focus 2
  it('tolerates spaces, leading zeros, and an frc prefix', () => {
    expect(parseTeamInput(' 341b ')).toBe('frc341B');
    expect(parseTeamInput('0341')).toBe('frc341');
    expect(parseTeamInput('frc341')).toBe('frc341');
    expect(parseTeamInput('FRC341B')).toBe('frc341B');
  });

  it('rejects junk', () => {
    for (const bad of ['', '0', '000', '34a1', '341bb', '123456', 'abc', '-5', '3.5', 'frc']) {
      expect(parseTeamInput(bad), bad).toBeNull();
    }
  });
});

describe('isTeamKey', () => {
  it('matches the database check constraint', () => {
    expect(isTeamKey('frc341')).toBe(true);
    expect(isTeamKey('frc341B')).toBe(true);
    expect(isTeamKey('frc0341')).toBe(false);
    expect(isTeamKey('frc341b')).toBe(false);
    expect(isTeamKey('341')).toBe(false);
  });
});

describe('normalizeEventKey', () => {
  it('lowercases and trims', () => {
    expect(normalizeEventKey(' 2025PARR ')).toBe('2025parr');
  });
  it('rejects bad keys', () => {
    expect(normalizeEventKey('parr2025')).toBeNull();
    expect(normalizeEventKey('2025')).toBeNull();
    expect(normalizeEventKey('2025 parr')).toBeNull();
  });
});

describe('teamLabel', () => {
  it('strips the frc prefix', () => {
    expect(teamLabel('frc341B')).toBe('341B');
  });
});

describe('mergePool', () => {
  it('merges TBA teams with manual teams, deduplicated and sorted', () => {
    const pool = mergePool(
      [
        { key: 'frc5181', nickname: 'Explorer Robotics' },
        { key: 'frc341', nickname: 'Miss Daisy' },
        { key: 'frc341B', nickname: 'Miss Daisy B' },
      ],
      ['frc9999', 'frc341', 'frc25'],
    );
    expect(pool.map((t) => t.teamKey)).toEqual(['frc25', 'frc341', 'frc341B', 'frc5181', 'frc9999']);
    expect(pool.find((t) => t.teamKey === 'frc341')).toEqual({
      teamKey: 'frc341',
      label: '341',
      nickname: 'Miss Daisy',
      manual: false,
    });
    expect(pool.find((t) => t.teamKey === 'frc25')).toEqual({
      teamKey: 'frc25',
      label: '25',
      nickname: null,
      manual: true,
    });
  });

  it('treats a null TBA list as empty', () => {
    expect(mergePool(null, ['frc341']).map((t) => t.teamKey)).toEqual(['frc341']);
  });

  it('skips TBA entries with malformed keys', () => {
    expect(mergePool([{ key: 'bogus', nickname: 'x' }], [])).toEqual([]);
  });
});
