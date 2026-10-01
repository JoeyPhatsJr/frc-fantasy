import { randomUUID } from 'node:crypto';
import { HttpError } from '@/lib/api/http';
import type { SessionUser } from '@/lib/auth/session';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRole, LeagueRow, PlayerRow } from '@/lib/db/types';

// Route tests swap the real session module for this one:
//   vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
// and choose who is "signed in" with setUser().

let current: SessionUser | null = null;

export function setUser(user: SessionUser | null): void {
  current = user;
}

export const fakeSession = {
  getUser: async (): Promise<SessionUser | null> => current,
  requireUser: async (): Promise<SessionUser> => {
    if (!current) throw new HttpError(401, 'Sign in first');
    return current;
  },
};

/** A user with a profile, not signed in yet. */
export async function makeUser(repo: Repo, displayName = 'Pat'): Promise<SessionUser> {
  const id = randomUUID();
  await repo.createProfile({ id, displayName, avatarUrl: null });
  return { id, email: `${displayName.toLowerCase().replace(/\W+/g, '')}@example.com` };
}

/** Makes a user, adds them to the league, and signs them in. */
export async function signInAsMember(
  repo: Repo,
  league: LeagueRow,
  name = 'Pat',
  role: LeagueRole = 'player',
): Promise<{ user: SessionUser; player: PlayerRow }> {
  const user = await makeUser(repo, name);
  const player = await repo.createMember({ leagueId: league.id, userId: user.id, name, role });
  setUser(user);
  return { user, player };
}
