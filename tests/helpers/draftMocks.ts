import { vi } from 'vitest';
import type { SessionUser } from '@/lib/auth/session';
import type { Repo } from '@/lib/db/repo';

// Lives here, not in ./draft: draft.ts pulls in the app modules that tests mock with these factories,
// so importing it from here would make the vi.mock factories wait on themselves forever.
export const TBA_TEAMS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
  key: `frc${n}`,
  team_number: n,
  nickname: `Team ${n}`,
}));

export const mocks = {
  repo: undefined as unknown as Repo,
  user: null as SessionUser | null,
  getTba: vi.fn(),
  ring: vi.fn(async (_roundId: string) => {}),
};

/** Call in beforeEach. TBA knows eight teams at every event. */
export function resetDraftMocks(repo: Repo): void {
  mocks.repo = repo;
  mocks.user = null;
  mocks.getTba.mockReset();
  mocks.getTba.mockImplementation(async () => ({
    data: TBA_TEAMS,
    fetchedAt: '2026-10-23T22:00:00.000Z',
    stale: false,
  }));
  mocks.ring.mockClear();
}

export const dbModule = { getRepo: () => mocks.repo };
export const tbaModule = { getTba: (...args: unknown[]) => mocks.getTba(...args) };
export const doorbellModule = {
  ring: (roundId: string) => mocks.ring(roundId),
  draftTopic: (roundId: string) => `draft:${roundId}`,
  DOORBELL_EVENT: 'changed',
};
// Same behavior as SP1's lib/auth/session.ts, reading the user from `mocks`.
export const sessionModule = {
  getUser: async () => mocks.user,
  requireUser: async () => {
    if (!mocks.user) {
      const { HttpError } = await import('@/lib/api/http');
      throw new HttpError(401, 'Sign in first');
    }
    return mocks.user;
  },
};
