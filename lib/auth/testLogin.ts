import { safeEqual } from '@/lib/auth/commissioner';

/** Spec §8.1: only with a secret configured, the matching bearer, and never on any Vercel deploy. */
export function testLoginAllowed(req: Request, env: { E2E_AUTH_SECRET?: string; VERCEL?: string }): boolean {
  const secret = env.E2E_AUTH_SECRET;
  if (!secret || env.VERCEL) return false;
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  return token !== '' && safeEqual(token, secret);
}
