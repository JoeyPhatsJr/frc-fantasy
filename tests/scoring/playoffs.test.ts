import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import {
  allianceLines,
  allianceMembers,
  eventResultLines,
  finalsResult,
  playoffLines,
} from '@/lib/scoring/playoffs';
import { alliance, match } from '../helpers/builders';

const A0 = ['frc1', 'frc2', 'frc3'];
const A1 = ['frc4', 'frc5', 'frc6'];

describe('allianceMembers', () => {
  it('is picks plus the backup robot that came in', () => {
    expect(allianceMembers(alliance(A0, { backup: { in: 'frc9', out: 'frc3' } }))).toEqual([...A0, 'frc9']);
    expect(allianceMembers(alliance(A0))).toEqual(A0);
  });
});

describe('allianceLines (§3.4.3)', () => {
  it('scores captain, first, second, and third pick', () => {
    const lines = allianceLines([alliance(['frc4', 'frc5', 'frc6', 'frc7'])], DEFAULT_SCORING);
    expect(lines.get('frc4')).toEqual({ category: 'alliance', label: 'Alliance captain', points: 8 });
    expect(lines.get('frc5')).toEqual({ category: 'alliance', label: 'Alliance first pick', points: 6 });
    expect(lines.get('frc6')).toEqual({ category: 'alliance', label: 'Alliance second pick', points: 3 });
    expect(lines.get('frc7')).toEqual({ category: 'alliance', label: 'Alliance third pick', points: 2 });
  });

  it('scores a backup robot, and the robot it replaced keeps its pick points', () => {
    const lines = allianceLines([alliance(A0, { backup: { in: 'frc9', out: 'frc3' } })], DEFAULT_SCORING);
    expect(lines.get('frc9')).toEqual({ category: 'alliance', label: 'Backup robot', points: 2 });
    expect(lines.get('frc3')!.points).toBe(3);
  });

  it('scores a team listed twice only once, at its highest-valued position', () => {
    const lines = allianceLines([alliance(['frc4', 'frc1', 'frc5']), alliance(['frc1', 'frc2', 'frc3'])], DEFAULT_SCORING);
    expect(lines.get('frc1')).toEqual({ category: 'alliance', label: 'Alliance captain', points: 8 });
  });

  it('ignores picks beyond the fourth', () => {
    const lines = allianceLines([alliance(['frc1', 'frc2', 'frc3', 'frc4', 'frc5'])], DEFAULT_SCORING);
    expect(lines.has('frc5')).toBe(false);
  });

  it('handles null and empty input', () => {
    expect(allianceLines(null, DEFAULT_SCORING).size).toBe(0);
    expect(allianceLines([], DEFAULT_SCORING).size).toBe(0);
  });
});

describe('playoffLines (§3.4.4)', () => {
  it('counts wins per team that played, skipping quals', () => {
    const matches = [
      match({ num: 1, red: A0, blue: A1, redScore: 50, blueScore: 10 }), // qual, ignored
      match({ level: 'sf', set: 1, num: 1, red: A0, blue: A1, redScore: 50, blueScore: 10 }),
      match({ level: 'sf', set: 2, num: 1, red: A0, blue: A1, redScore: 5, blueScore: 10 }),
      match({ level: 'f', set: 1, num: 1, red: A0, blue: A1, redScore: 50, blueScore: 10 }),
    ];
    const lines = playoffLines(matches, DEFAULT_SCORING);
    expect(lines.get('frc1')).toEqual({ category: 'playoffWins', label: 'Playoff wins ×2', quantity: 2, points: 8 });
    expect(lines.get('frc4')).toEqual({ category: 'playoffWins', label: 'Playoff wins ×1', quantity: 1, points: 4 });
  });

  it('awards nothing for a tied match with no winner (2025parr Match 3)', () => {
    const matches = [
      match({ level: 'sf', set: 3, num: 1, red: A0, blue: A1, redScore: 156, blueScore: 156, winner: '' }),
    ];
    expect(playoffLines(matches, DEFAULT_SCORING).size).toBe(0);
  });

  it('skips surrogates and disqualified teams', () => {
    const matches = [
      match({
        level: 'sf', set: 1, num: 1, red: A0, blue: A1, redScore: 50, blueScore: 10,
        redSurrogates: ['frc2'], redDq: ['frc3'],
      }),
    ];
    const lines = playoffLines(matches, DEFAULT_SCORING);
    expect([...lines.keys()]).toEqual(['frc1']);
  });

  it('ignores unplayed playoff matches and null input', () => {
    expect(playoffLines([match({ level: 'f', set: 1, num: 1, red: A0, blue: A1 })], DEFAULT_SCORING).size).toBe(0);
    expect(playoffLines(null, DEFAULT_SCORING).size).toBe(0);
  });
});

describe('finalsResult (§7.7)', () => {
  it('primary: reads winner and finalist from alliance status', () => {
    const alliances = [
      alliance(['frc1', 'frc2', 'frc3'], { status: { level: 'sf', status: 'eliminated' } }),
      alliance(['frc4', 'frc5', 'frc6'], { status: { level: 'sf', status: 'eliminated' } }),
      alliance(['frc7', 'frc8', 'frc9'], { status: { level: 'f', status: 'won' } }),
      alliance(['frc10', 'frc11', 'frc12'], { status: { level: 'f', status: 'eliminated' } }),
    ];
    expect(finalsResult(alliances, null)).toEqual({ winner: 2, finalist: 3 });
  });

  it('gives nothing while the finals are still being played', () => {
    const alliances = [
      alliance(A0, { status: { level: 'f', status: 'playing' } }),
      alliance(A1, { status: { level: 'f', status: 'playing' } }),
    ];
    expect(finalsResult(alliances, [])).toEqual({ winner: null, finalist: null });
  });

  it('fallback: tallies per alliance even when colors swap between matches', () => {
    const alliances = [alliance(A0), alliance(A1)];
    const matches = [
      match({ level: 'f', set: 1, num: 1, red: A0, blue: A1, redScore: 80, blueScore: 70 }),
      match({ level: 'f', set: 1, num: 2, red: A1, blue: A0, redScore: 60, blueScore: 90 }), // A0 is blue now
    ];
    expect(finalsResult(alliances, matches)).toEqual({ winner: 0, finalist: 1 });
  });

  it('fallback: handles a three-match final', () => {
    const alliances = [alliance(A0), alliance(A1)];
    const matches = [
      match({ level: 'f', set: 1, num: 3, red: A0, blue: A1, redScore: 10, blueScore: 70 }),
      match({ level: 'f', set: 1, num: 1, red: A0, blue: A1, redScore: 80, blueScore: 70 }),
      match({ level: 'f', set: 1, num: 2, red: A0, blue: A1, redScore: 10, blueScore: 70 }),
    ];
    expect(finalsResult(alliances, matches)).toEqual({ winner: 1, finalist: 0 });
  });

  it('fallback: no result until someone has two finals wins', () => {
    const alliances = [alliance(A0), alliance(A1)];
    const matches = [
      match({ level: 'f', set: 1, num: 1, red: A0, blue: A1, redScore: 80, blueScore: 70 }),
      match({ level: 'f', set: 1, num: 2, red: A0, blue: A1, redScore: 70, blueScore: 70, winner: '' }),
    ];
    expect(finalsResult(alliances, matches)).toEqual({ winner: null, finalist: null });
  });

  it('fallback: recognizes an alliance playing with its backup robot', () => {
    const alliances = [alliance(A0, { backup: { in: 'frc9', out: 'frc3' } }), alliance(A1)];
    const lineup = ['frc1', 'frc2', 'frc9'];
    const matches = [
      match({ level: 'f', set: 1, num: 1, red: lineup, blue: A1, redScore: 80, blueScore: 70 }),
      match({ level: 'f', set: 1, num: 2, red: lineup, blue: A1, redScore: 80, blueScore: 70 }),
    ];
    expect(finalsResult(alliances, matches)).toEqual({ winner: 0, finalist: 1 });
  });

  it('fallback: ignores a side that matches no alliance', () => {
    const alliances = [alliance(A0)];
    const strangers = ['frc77', 'frc78', 'frc79'];
    const matches = [
      match({ level: 'f', set: 1, num: 1, red: strangers, blue: A0, redScore: 1, blueScore: 70 }),
      match({ level: 'f', set: 1, num: 2, red: strangers, blue: A0, redScore: 1, blueScore: 70 }),
    ];
    expect(finalsResult(alliances, matches)).toEqual({ winner: 0, finalist: null });
  });

  it('ignores non-finals matches in the fallback', () => {
    const alliances = [alliance(A0), alliance(A1)];
    const matches = [
      match({ level: 'sf', set: 1, num: 1, red: A0, blue: A1, redScore: 80, blueScore: 70 }),
      match({ level: 'sf', set: 2, num: 1, red: A0, blue: A1, redScore: 80, blueScore: 70 }),
    ];
    expect(finalsResult(alliances, matches)).toEqual({ winner: null, finalist: null });
  });

  it('handles null input', () => {
    expect(finalsResult(null, null)).toEqual({ winner: null, finalist: null });
  });
});

describe('eventResultLines', () => {
  it('gives winner and finalist points to every member, including 4th pick and backup', () => {
    const alliances = [
      alliance(['frc1', 'frc2', 'frc3', 'frc4'], {
        backup: { in: 'frc9', out: 'frc3' },
        status: { level: 'f', status: 'won' },
      }),
      alliance(['frc5', 'frc6', 'frc7'], { status: { level: 'f', status: 'eliminated' } }),
    ];
    const lines = eventResultLines(alliances, null, DEFAULT_SCORING);
    for (const k of ['frc1', 'frc2', 'frc3', 'frc4', 'frc9']) {
      expect(lines.get(k), k).toEqual({ category: 'eventResult', label: 'Event winner', points: 15 });
    }
    for (const k of ['frc5', 'frc6', 'frc7']) {
      expect(lines.get(k), k).toEqual({ category: 'eventResult', label: 'Event finalist', points: 8 });
    }
  });

  it('gives nothing when unresolved', () => {
    expect(eventResultLines([alliance(A0), alliance(A1)], [], DEFAULT_SCORING).size).toBe(0);
  });
});
