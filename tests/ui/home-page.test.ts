import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => hoisted.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
vi.mock('@/lib/tba/client', () => ({ getTba: async () => ({ data: null, fetchedAt: null, stale: false }) }));
vi.mock('@/lib/views/landing', () => ({ loadUpcomingEvents: async () => [] }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  usePathname: () => '/',
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
// AutoRefresh renders nothing; swap in a marker so the page's refresh choice shows in the markup.
vi.mock('@/components/AutoRefresh', async () => {
  const { createElement } = await import('react');
  return { AutoRefresh: ({ seconds }: { seconds: number }) => createElement('i', { 'data-auto-refresh': seconds }) };
});

import HomePage from '@/app/page';
import LeaguesPage from '@/app/leagues/page';
import YouPage from '@/app/you/page';
import type { Repo } from '@/lib/db/repo';
import { defaultScoring } from '@/lib/scoring/config';
import { makeUser, setUser } from '../helpers/auth';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;

beforeEach(() => {
  repo = createMemoryRepo();
  hoisted.repo = repo;
  setUser(null);
});

const home = async () =>
  renderToStaticMarkup((await HomePage({ searchParams: Promise.resolve({}) })) as ReactElement);
const leagues = async () => renderToStaticMarkup((await LeaguesPage()) as ReactElement);

describe('Home, signed in with no leagues (spec §6.1)', () => {
  it('shows the Welcome! hero with the invite box and Create a league', async () => {
    setUser(await makeUser(repo, 'Newbie'));
    const out = await home();
    expect(out).toContain('Welcome!');
    expect(out).toContain('Have an invite code?');
    expect(out).toContain('name="code"');
    expect(out).toContain('Create a league');
    expect(out).toContain('href="/leagues/new"');
    expect(out).not.toContain('Up next');
    expect(out).not.toContain('data-auto-refresh');
  });
});

describe('Home and Leagues wait for a live draft (spec §5.5)', () => {
  async function seedDraftSoon(draftMode: 'live' | 'commissioner') {
    const { league } = await seedLeague(repo); // signs in the commissioner
    const round = await repo.createRound({
      leagueId: league.id, eventKey: '2099parr', eventName: 'Ramp Riot', startDate: '2099-10-24',
      endDate: '2099-10-24', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    await repo.updateRound(round.id, { draftMode });
  }

  it('refreshes every 30 s while a live draft is coming up', async () => {
    await seedDraftSoon('live');
    const h = await home();
    expect(h).toContain('Ramp Riot draft coming up');
    expect(h).toContain('data-auto-refresh="30"');
    expect(await leagues()).toContain('data-auto-refresh="30"');
  });

  it('does not refresh for a hand-entered draft', async () => {
    await seedDraftSoon('commissioner');
    expect(await home()).not.toContain('data-auto-refresh');
    expect(await leagues()).not.toContain('data-auto-refresh');
  });
});

describe('/you (spec §6.7)', () => {
  it('orders the sections Profile · My season · Appearance · Account', async () => {
    setUser(await makeUser(repo, 'Joey'));
    const out = renderToStaticMarkup((await YouPage()) as ReactElement);
    const at = (label: string) => out.indexOf(`>${label}</h2>`);
    expect(at('Profile')).toBeGreaterThan(-1);
    expect(at('Profile')).toBeLessThan(at('My season'));
    expect(at('My season')).toBeLessThan(at('Appearance'));
    expect(at('Appearance')).toBeLessThan(at('Account'));
  });
});
