import { describe, expect, it } from 'vitest';
import { cleanName, NAME_MAX, uniqueName } from '@/lib/leagues/names';

describe('cleanName (spec §4.8)', () => {
  it('trims and keeps 1–40 characters', () => {
    expect(cleanName('  Mom ')).toBe('Mom');
    expect(cleanName('x'.repeat(40))).toBe('x'.repeat(40));
  });
  it('rejects empty, too long, control characters, and non-strings', () => {
    for (const raw of ['', '   ', 'x'.repeat(41), 'Mo\u0000m', 'Tab\there', 42, null]) {
      expect(cleanName(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

describe('uniqueName (spec §4.3)', () => {
  it('keeps a free name', () => {
    expect(uniqueName('Mom', ['Dad'])).toBe('Mom');
  });
  it('appends 2, 3, … case-insensitively', () => {
    expect(uniqueName('Mom', ['mom'])).toBe('Mom 2');
    expect(uniqueName('Mom', ['MOM', 'Mom 2'])).toBe('Mom 3');
  });
  it('trims the base so a suffixed 40-character name still fits', () => {
    const base = 'A'.repeat(NAME_MAX);
    const out = uniqueName(base, [base]);
    expect(out).toBe(`${'A'.repeat(NAME_MAX - 2)} 2`);
    expect(out).toHaveLength(NAME_MAX);
  });
  it('drops a trailing space left by trimming', () => {
    const base = `${'A'.repeat(37)} BC`; // 40 chars; cut to 38 ends with a space
    expect(uniqueName(base, [base])).toBe(`${'A'.repeat(37)} 2`);
  });
});
