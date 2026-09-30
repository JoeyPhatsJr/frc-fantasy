import { describe, expect, it } from 'vitest';
import {
  generateAdminToken,
  hashToken,
  makeSlug,
  safeEqual,
  SLUG_RE,
  verifyToken,
} from '@/lib/auth/commissioner';

describe('admin tokens (§4)', () => {
  it('generates 32 random bytes as base64url', () => {
    const token = generateAdminToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(generateAdminToken()).not.toBe(token);
  });

  it('hashes with SHA-256 as hex', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('verifies the right token and rejects everything else', () => {
    const token = generateAdminToken();
    const hash = hashToken(token);
    expect(verifyToken(token, hash)).toBe(true);
    expect(verifyToken(`${token}x`, hash)).toBe(false);
    expect(verifyToken(generateAdminToken(), hash)).toBe(false);
    expect(verifyToken('', hash)).toBe(false);
    expect(verifyToken(hash, hash)).toBe(false); // the hash itself is not the token
  });

  it('rejects absurdly long tokens and broken stored hashes without throwing', () => {
    const token = generateAdminToken();
    expect(verifyToken('x'.repeat(10_000), hashToken(token))).toBe(false);
    expect(verifyToken(token, 'not-hex')).toBe(false);
    expect(verifyToken(token, '')).toBe(false);
  });
});

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
