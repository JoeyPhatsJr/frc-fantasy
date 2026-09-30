import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown, loads: 0 }));
vi.mock('@/lib/views/league', async (orig) => {
  const m = await orig<typeof import('@/lib/views/league')>();
  return { ...m, loadLeaguePage: (...a: Parameters<typeof m.loadLeaguePage>) => (h.loads++, m.loadLeaguePage(...a)) };
});
vi.mock('@/lib/views/round', async (orig) => {
  const m = await orig<typeof import('@/lib/views/round')>();
  return { ...m, loadRoundPage: (...a: Parameters<typeof m.loadRoundPage>) => (h.loads++, m.loadRoundPage(...a)) };
});
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
vi.mock('@/lib/tba/client', () => ({ getTba: async () => ({ data: null, fetchedAt: null, stale: false }) }));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  usePathname: () => '/',
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

import LeaguePage from '@/app/l/[slug]/page';
import RoundPage from '@/app/l/[slug]/r/[roundId]/page';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { makeUser, setUser } from '../helpers/auth';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;
let round: RoundRow;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  ({ league } = await seedLeague(repo, { visibility: 'members', signIn: false }));
  await repo.createPlayer(league.id, 'SecretMom');
  round = await repo.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot', startDate: '2025-10-25',
    endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
  });
  setUser(null);
  h.loads = 0;
});

async function html(el: Promise<ReactElement>) {
  return renderToStaticMarkup(await el);
}

describe('members-only leagues (spec §4.5)', () => {
  it('shows the private card, with no league data, to signed-out visitors', async () => {
    const out = await html(LeaguePage({ params: Promise.resolve({ slug: league.slug }) }));
    expect(out).toContain('Private league');
    expect(out).toContain('Continue with Google');
    for (const secret of ['Habich Fam', 'SecretMom', 'Commish', 'Ramp Riot']) expect(out).not.toContain(secret);
  });
  it('shows the same card to signed-in non-members on the round page', async () => {
    setUser(await makeUser(repo, 'Stranger'));
    const out = await html(RoundPage({ params: Promise.resolve({ slug: league.slug, roundId: round.id }) }));
    expect(out).toContain('Private league — ask the commissioner for an invite code');
    expect(out).not.toContain('Continue with Google');
    for (const secret of ['Habich Fam', 'SecretMom', 'Ramp Riot']) expect(out).not.toContain(secret);
  });
  it('never calls the league or round data loaders for non-members', async () => {
    await html(LeaguePage({ params: Promise.resolve({ slug: league.slug }) }));
    await html(RoundPage({ params: Promise.resolve({ slug: league.slug, roundId: round.id }) }));
    expect(h.loads).toBe(0);
  });
});
