import { describe, expect, it } from 'vitest';
import { generateInviteCode, INVITE_CODE_RE, normalizeInviteCode } from '@/lib/leagues/inviteCode';

describe('generateInviteCode (spec §4.4)', () => {
  it('makes 6 characters from the no-lookalikes alphabet', () => {
    for (let i = 0; i < 200; i++) expect(generateInviteCode()).toMatch(INVITE_CODE_RE);
  });
  it('never uses 0, O, 1, I or L', () => {
    const all = Array.from({ length: 500 }, () => generateInviteCode()).join('');
    expect(all).not.toMatch(/[0O1IL]/);
  });
  it('uses the random source it is given', () => {
    expect(generateInviteCode(() => 0)).toBe('222222');
    expect(generateInviteCode((n) => n - 1)).toBe('ZZZZZZ');
  });
});

describe('normalizeInviteCode', () => {
  it('trims and uppercases a valid code', () => {
    expect(normalizeInviteCode(' abc234 ')).toBe('ABC234');
  });
  it('rejects anything that is not a possible code', () => {
    for (const raw of ['', 'ABC23', 'ABC2345', 'ABC10O', 'ABC-23', 'ÅBC234']) {
      expect(normalizeInviteCode(raw), raw).toBeNull();
    }
  });
});
