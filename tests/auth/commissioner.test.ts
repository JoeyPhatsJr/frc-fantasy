import { describe, expect, it } from 'vitest';
import { makeSlug, safeEqual, SLUG_RE } from '@/lib/auth/commissioner';

describe('safeEqual', () => {
  it('compares strings of any length', () => {
    expect(safeEqual('ramp riot', 'ramp riot')).toBe(true);
    expect(safeEqual('ramp riot', 'ramp riot!')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });
});

describe('makeSlug', () => {
  it('is the name plus six random base32 characters', () => {
    expect(makeSlug('Habich Fam')).toMatch(/^habich-fam-[a-z2-7]{6}$/);
  });
  it('differs each time', () => {
    expect(makeSlug('Habich Fam')).not.toBe(makeSlug('Habich Fam'));
  });
  it('cleans up punctuation, accents, and extra spaces', () => {
    expect(makeSlug("  Joey's  Léague!! ")).toMatch(/^joey-s-league-[a-z2-7]{6}$/);
  });
  it('falls back to "league" when nothing usable is left', () => {
    expect(makeSlug('!!!')).toMatch(/^league-[a-z2-7]{6}$/);
    expect(makeSlug('🤖🤖')).toMatch(/^league-[a-z2-7]{6}$/);
  });
  it('caps the name part at 30 characters and never ends it with a dash', () => {
    const slug = makeSlug('a'.repeat(29) + ' bbbbbbbb');
    expect(slug).toMatch(/^a{29}-[a-z2-7]{6}$/);
  });
  it('always matches SLUG_RE', () => {
    for (const name of ['Habich Fam', '!!!', 'x'.repeat(80), '5181 Friends']) {
      expect(makeSlug(name)).toMatch(SLUG_RE);
    }
  });
});
