import { describe, expect, it } from 'vitest';
import { oauthRedirectUrl, safeNext } from '@/lib/auth/next';

describe('safeNext (spec §4.1 open-redirect rule)', () => {
  it('keeps same-origin relative paths, including query and hash', () => {
    expect(safeNext('/')).toBe('/');
    expect(safeNext('/l/habich-fam-abc234/admin')).toBe('/l/habich-fam-abc234/admin');
    expect(safeNext('/join/ABC234?x=1#top')).toBe('/join/ABC234?x=1#top');
  });

  it('turns everything else into /', () => {
    const bad = [
      null,
      undefined,
      '',
      'l/abc',
      '//evil.com',
      '//evil.com/l/abc',
      '/\\evil.com',
      '/\\/evil.com',
      'https://evil.com',
      'javascript:alert(1)',
      '%2F%2Fevil.com',
      '/ok\nSet-Cookie: x=1',
      '/has\\backslash',
      `/${'a'.repeat(2001)}`,
      // Regression: dot-segment collapsing (spec §4.1 requires post-normalization check)
      '/.//evil.com',
      '/a/..//evil.com',
      '/..//evil.com',
      '/%2e//evil.com',
      '/\t/evil.com',
    ];
    for (const raw of bad) expect(safeNext(raw), String(raw)).toBe('/');
  });
});

describe('oauthRedirectUrl', () => {
  it('points the provider back at /auth/callback with a sanitized next', () => {
    expect(oauthRedirectUrl('https://frc.example', '/join/ABC234')).toBe(
      'https://frc.example/auth/callback?next=%2Fjoin%2FABC234',
    );
    expect(oauthRedirectUrl('https://frc.example/', '//evil.com')).toBe('https://frc.example/auth/callback?next=%2F');
  });
});
