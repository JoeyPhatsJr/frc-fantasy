import { generateAdminToken, hashToken } from '@/lib/auth/commissioner';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';

/** Builds a Request like the browser would send. A string body is sent as-is (for bad-JSON tests). */
export function request(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Request {
  const headers = new Headers();
  if (opts.token !== undefined) headers.set('x-commissioner-key', opts.token);
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  return new Request(`http://test.local${path}`, { method, headers, body });
}

/** Next.js 16 passes route params as a Promise. */
export function params<T>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) };
}

export async function seedLeague(
  repo: Repo,
  opts: { name?: string; slug?: string } = {},
): Promise<{ league: LeagueRow; token: string }> {
  const token = generateAdminToken();
  const league = await repo.createLeague({
    slug: opts.slug ?? 'habich-fam-abc234',
    name: opts.name ?? 'Habich Fam',
    adminTokenHash: hashToken(token),
    defaultScoring: defaultScoring(),
  });
  return { league, token };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson(res: Response): Promise<any> {
  return res.json();
}
