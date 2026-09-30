import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const MAX_TOKEN_LENGTH = 200;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function generateAdminToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return sha256(token).toString('hex');
}

/** Constant-time compare. Hashing first makes both sides the same length. */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

export function verifyToken(token: string, storedHash: string): boolean {
  if (!token || token.length > MAX_TOKEN_LENGTH) return false;
  if (!/^[0-9a-f]{64}$/.test(storedHash)) return false;
  return timingSafeEqual(sha256(token), Buffer.from(storedHash, 'hex'));
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
