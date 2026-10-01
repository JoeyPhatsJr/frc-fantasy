import { describe, expect, it } from 'vitest';
import { autoAddedNote, parseFollowInput } from '@/lib/follow/input';

describe('parseFollowInput', () => {
  it('reads numbers separated by commas or spaces, dropping repeats', () => {
    expect(parseFollowInput('5181, 341 5181')).toEqual({ teams: [5181, 341] });
    expect(parseFollowInput('  ')).toEqual({ teams: [] });
    expect(parseFollowInput('frc5181')).toEqual({ teams: [5181] });
  });

  it('explains what is wrong', () => {
    expect(parseFollowInput('1, 2, 3, 4')).toEqual({ error: 'Follow at most 3 teams' });
    expect(parseFollowInput('51a81')).toEqual({ error: '"51a81" isn\'t a team number' });
    expect(parseFollowInput('0')).toEqual({ error: '"0" isn\'t a team number' });
  });
});

describe('autoAddedNote', () => {
  it('names the followed teams', () => {
    expect(autoAddedNote([5181])).toBe('Auto-added · following 5181');
    expect(autoAddedNote([341, 5181])).toBe('Auto-added · following 341, 5181');
    expect(autoAddedNote([])).toBe('Auto-added');
  });
});
