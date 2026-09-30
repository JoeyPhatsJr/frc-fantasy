import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { awardLines, oprLines, oprRanks } from '@/lib/scoring/bonus';
import type { Award } from '@/lib/tba/types';

function award(type: number, name: string, teams: (string | null)[]): Award {
  return {
    name,
    award_type: type,
    recipient_list: teams.map((t) => ({ team_key: t, awardee: t ? null : 'A Person' })),
  };
}

describe('awardLines (§3.4.5)', () => {
  it('scores Impact, Engineering Inspiration, and Rookie All-Star by type', () => {
    const lines = awardLines(
      [
        award(0, 'Impact Award', ['frc1']),
        award(9, 'Engineering Inspiration Award', ['frc2']),
        award(10, 'Rookie All-Star Award', ['frc3']),
      ],
      DEFAULT_SCORING,
    );
    expect(lines.get('frc1')).toEqual([{ category: 'awards', label: 'Impact Award', points: 10 }]);
    expect(lines.get('frc2')![0].points).toBe(8);
    expect(lines.get('frc3')![0].points).toBe(6);
  });

  it('scores any other team award at the default', () => {
    const lines = awardLines([award(29, 'Industrial Design Award', ['frc1'])], DEFAULT_SCORING);
    expect(lines.get('frc1')).toEqual([{ category: 'awards', label: 'Industrial Design Award', points: 5 }]);
  });

  it('excludes winner, finalist, individual, and seed awards', () => {
    const excluded = [1, 2, 3, 4, 5, 6, 7, 14, 39];
    const awards = excluded.map((t) => award(t, `Type ${t}`, ['frc1']));
    expect(awardLines(awards, DEFAULT_SCORING).size).toBe(0);
  });

  it('skips recipients with no team', () => {
    expect(awardLines([award(29, 'Some Award', [null])], DEFAULT_SCORING).size).toBe(0);
  });

  it('stacks several awards on one team', () => {
    const lines = awardLines(
      [award(0, 'Impact Award', ['frc1']), award(29, 'Industrial Design Award', ['frc1'])],
      DEFAULT_SCORING,
    );
    expect(lines.get('frc1')!.map((l) => l.points)).toEqual([10, 5]);
  });

  it('counts a team once per award even if listed twice', () => {
    const lines = awardLines([award(29, 'Some Award', ['frc1', 'frc1'])], DEFAULT_SCORING);
    expect(lines.get('frc1')).toHaveLength(1);
  });

  it('works with B-team keys', () => {
    const lines = awardLines([award(29, 'Some Award', ['frc341B'])], DEFAULT_SCORING);
    expect(lines.get('frc341B')![0].points).toBe(5);
  });

  it('handles null, empty, and a null recipient list', () => {
    expect(awardLines(null, DEFAULT_SCORING).size).toBe(0);
    expect(awardLines([], DEFAULT_SCORING).size).toBe(0);
    const broken = { name: 'x', award_type: 29, recipient_list: null } as unknown as Award;
    expect(awardLines([broken], DEFAULT_SCORING).size).toBe(0);
  });
});

describe('oprRanks', () => {
  it('ranks descending', () => {
    const ranks = oprRanks({ oprs: { frc1: 10.5, frc2: 80.2, frc3: 40 } });
    expect(ranks.get('frc2')).toBe(1);
    expect(ranks.get('frc3')).toBe(2);
    expect(ranks.get('frc1')).toBe(3);
  });

  it('uses competition ranking for ties: 1, 1, 3', () => {
    const ranks = oprRanks({ oprs: { frc1: 50, frc2: 50, frc3: 40 } });
    expect(ranks.get('frc1')).toBe(1);
    expect(ranks.get('frc2')).toBe(1);
    expect(ranks.get('frc3')).toBe(3);
  });

  it('treats floats within 1e-6 as equal', () => {
    const ranks = oprRanks({ oprs: { frc1: 50.0000001, frc2: 50.0000004, frc3: 49.99 } });
    expect(ranks.get('frc1')).toBe(1);
    expect(ranks.get('frc2')).toBe(1);
    expect(ranks.get('frc3')).toBe(3);
  });

  it('does not treat a 1e-5 gap as a tie', () => {
    const ranks = oprRanks({ oprs: { frc1: 50.00001, frc2: 50 } });
    expect(ranks.get('frc1')).toBe(1);
    expect(ranks.get('frc2')).toBe(2);
  });

  it('ignores non-numeric values and handles null', () => {
    const ranks = oprRanks({ oprs: { frc1: Number.NaN, frc2: 5 } });
    expect(ranks.has('frc1')).toBe(false);
    expect(ranks.get('frc2')).toBe(1);
    expect(oprRanks(null).size).toBe(0);
    expect(oprRanks({ oprs: null }).size).toBe(0);
  });
});

describe('oprLines (§3.4.6)', () => {
  const oprs = { oprs: { frc1: 90, frc2: 80, frc3: 70, frc4: 60 } };

  it('awards +6, +4, +2 to the top three after quals', () => {
    const lines = oprLines(oprs, DEFAULT_SCORING, true);
    expect(lines.get('frc1')).toEqual({ category: 'oprBonus', label: 'OPR rank #1', quantity: 1, points: 6 });
    expect(lines.get('frc2')!.points).toBe(4);
    expect(lines.get('frc3')!.points).toBe(2);
    expect(lines.get('frc4')!.points).toBe(0);
  });

  it('awards nothing before quals are complete', () => {
    expect(oprLines(oprs, DEFAULT_SCORING, false).size).toBe(0);
  });

  it('gives tied teams the better bonus and skips the next place', () => {
    const lines = oprLines({ oprs: { frc1: 90, frc2: 90, frc3: 70 } }, DEFAULT_SCORING, true);
    expect(lines.get('frc1')!.points).toBe(6);
    expect(lines.get('frc2')!.points).toBe(6);
    expect(lines.get('frc3')!.points).toBe(2);
  });

  it('awards nothing when the config has no OPR bonus or TBA has no OPRs', () => {
    expect([...oprLines(oprs, { ...DEFAULT_SCORING, oprBonus: [] }, true).values()].every((l) => l.points === 0)).toBe(true);
    expect(oprLines(null, DEFAULT_SCORING, true).size).toBe(0);
  });
});
