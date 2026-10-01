import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Vercel cron sends `Authorization: Bearer $CRON_SECRET` (spec §8.1). Compared in constant time by
 * hashing both sides to the same length first. With no secret configured, nothing is authorized.
 */
export function cronAuthorized(authorization: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(authorization ?? ''), digest(`Bearer ${secret}`));
}
