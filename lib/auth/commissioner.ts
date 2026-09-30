import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Constant-time compare. Hashing first makes both sides the same length. */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

export function makeSlug(name: string): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // strip accents
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30)
      .replace(/-+$/, '') || 'league';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += BASE32[randomInt(BASE32.length)];
  return `${base}-${suffix}`;
}
