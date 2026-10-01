import type { SessionUser } from '@/lib/auth/session';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, PlayerRow, Visibility } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { makeUser, setUser } from './auth';

/** Builds a Request like the browser would send. A string body is sent as-is (for bad-JSON tests). */
export function request(method: string, path: string, opts: { body?: unknown } = {}): Request {
  const headers = new Headers();
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

/**
 * A league with one commissioner account named "Commish", signed in by default.
 * Pass { signIn: false } for a second league so the current user stays who they were.
 */
export async function seedLeague(
  repo: Repo,
  opts: { name?: string; slug?: string; visibility?: Visibility; signIn?: boolean } = {},
): Promise<{ league: LeagueRow; commissioner: PlayerRow; user: SessionUser }> {
  const user = await makeUser(repo, 'Commish');
  const league = await repo.createLeague({
    slug: opts.slug ?? 'habich-fam-abc234',
    name: opts.name ?? 'Habich Fam',
    defaultScoring: defaultScoring(),
    createdBy: user.id,
    visibility: opts.visibility,
  });
  const commissioner = await repo.createMember({
    leagueId: league.id,
    userId: user.id,
    name: 'Commish',
    role: 'commissioner',
  });
  if (opts.signIn !== false) setUser(user);
  return { league, commissioner, user };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson(res: Response): Promise<any> {
  return res.json();
}
