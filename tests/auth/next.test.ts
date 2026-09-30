import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/auth/next';

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
    ];
    for (const raw of bad) expect(safeNext(raw), String(raw)).toBe('/');
  });
});
