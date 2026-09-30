import { describe, expect, it } from 'vitest';
import { creditedTeams, hasResult, qualsComplete, winnerOf } from '@/lib/scoring/matches';
import { alliance, match } from '../helpers/builders';

const R = ['frc1', 'frc2', 'frc3'];
const B = ['frc4', 'frc5', 'frc6'];

describe('hasResult', () => {
  it('is false for unplayed matches (-1 scores)', () => {
    expect(hasResult(match({ num: 1, red: R, blue: B }))).toBe(false);
  });
  it('is true when both scores are 0 or more', () => {
    expect(hasResult(match({ num: 1, red: R, blue: B, redScore: 0, blueScore: 0 }))).toBe(true);
  });
  it('is false when alliances or a score is null', () => {
    const m = match({ num: 1, red: R, blue: B, redScore: 10, blueScore: 5 });
    expect(hasResult({ ...m, alliances: null })).toBe(false);
    m.alliances!.red.score = null;
    expect(hasResult(m)).toBe(false);
  });
});

describe('winnerOf', () => {
  it('returns null for unplayed matches', () => {
    expect(winnerOf(match({ num: 1, red: R, blue: B }))).toBeNull();
  });

  it('trusts winning_alliance even when scores disagree (§7.5)', () => {
    const m = match({ num: 1, red: R, blue: B, redScore: 100, blueScore: 120, winner: 'red' });
    expect(winnerOf(m)).toBe('red');
  });

  it('trusts winning_alliance on equal scores (tiebreaker applied by TBA)', () => {
    const m = match({ num: 1, red: R, blue: B, redScore: 50, blueScore: 50, winner: 'blue' });
    expect(winnerOf(m)).toBe('blue');
  });

  it('returns null when winning_alliance is an empty string', () => {
    const m = match({ num: 1, red: R, blue: B, redScore: 156, blueScore: 156, winner: '' });
    expect(winnerOf(m)).toBeNull();
  });

  it('does NOT compare scores when winning_alliance is an empty string', () => {
    const m = match({ num: 1, red: R, blue: B, redScore: 90, blueScore: 10, winner: '' });
    expect(winnerOf(m)).toBeNull();
  });

  it('falls back to comparing scores only when the field is absent', () => {
    expect(winnerOf(match({ num: 1, red: R, blue: B, redScore: 9, blueScore: 3, winner: 'absent' }))).toBe('red');
    expect(winnerOf(match({ num: 1, red: R, blue: B, redScore: 3, blueScore: 9, winner: 'absent' }))).toBe('blue');
    expect(winnerOf(match({ num: 1, red: R, blue: B, redScore: 3, blueScore: 3, winner: 'absent' }))).toBeNull();
  });

  it('treats a null winning_alliance like an absent one', () => {
    const m = match({ num: 1, red: R, blue: B, redScore: 9, blueScore: 3 });
    m.winning_alliance = null;
    expect(winnerOf(m)).toBe('red');
  });
});

describe('creditedTeams', () => {
  it('excludes surrogates and disqualified teams', () => {
    const m = match({
      num: 1, red: R, blue: B, redScore: 10, blueScore: 5,
      redSurrogates: ['frc2'], redDq: ['frc3'],
    });
    expect(creditedTeams(m, 'red')).toEqual(['frc1']);
    expect(creditedTeams(m, 'blue')).toEqual(B);
  });

  it('copes with null surrogate and dq arrays', () => {
    const m = match({ num: 1, red: R, blue: B, redScore: 10, blueScore: 5 });
    m.alliances!.red.surrogate_team_keys = null;
    m.alliances!.red.dq_team_keys = null;
    expect(creditedTeams(m, 'red')).toEqual(R);
  });
});

describe('qualsComplete (§7.6)', () => {
  const played = (n: number) => match({ num: n, red: R, blue: B, redScore: 10, blueScore: 5 });
  const unplayed = (n: number) => match({ num: n, red: R, blue: B });
  const sf = match({ level: 'sf', set: 1, num: 1, red: R, blue: B });

  it('is true when alliances exist, even with unplayed quals', () => {
    expect(qualsComplete([played(1), unplayed(2)], [alliance(R)])).toBe(true);
  });

  it('ignores alliances that have no picks', () => {
    expect(qualsComplete([played(1), unplayed(2)], [alliance([])])).toBe(false);
  });

  it('is true when all quals are played and a playoff match is scheduled', () => {
    expect(qualsComplete([played(1), played(2), sf], null)).toBe(true);
  });

  it('is false when all quals are played but no playoff match exists yet', () => {
    expect(qualsComplete([played(1), played(2)], null)).toBe(false);
  });

  it('is false when a qual is unplayed', () => {
    expect(qualsComplete([played(1), unplayed(2), sf], null)).toBe(false);
  });

  it('is false with no data', () => {
    expect(qualsComplete(null, null)).toBe(false);
    expect(qualsComplete([], [])).toBe(false);
    expect(qualsComplete([sf], null)).toBe(false);
  });
});
