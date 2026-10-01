import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => hoisted.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
vi.mock('@/lib/tba/client', () => ({ getTba: async () => ({ data: null, fetchedAt: null, stale: false }) }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  usePathname: () => '/',
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

import LeaguePage from '@/app/l/[slug]/page';
import { LeagueMeCardView, leaveConfirmText } from '@/components/LeagueMeCard';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { makeUser, setUser, signInAsMember } from '../helpers/auth';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

const noop = () => {};
const base = {
  leagueName: 'Habich Fam',
  name: 'Joey Habich',
  onName: noop,
  onSave: noop,
  onLeave: noop,
  onConfirmLeave: noop,
  onCancelLeave: noop,
  busy: null,
  confirming: false,
  message: null,
  saveDisabled: false,
} as const;

describe('LeagueMeCardView (spec §4.3 rename self / leave)', () => {
  it('shows the name field, Save, and Leave league', () => {
    const out = renderToStaticMarkup(h(LeagueMeCardView, base));
    expect(out).toContain('You in this league');
    expect(out).toContain('Your name in this league');
    expect(out).toContain('value="Joey Habich"');
    expect(out).toContain('maxLength="40"');
    expect(out).toContain('Save name');
    expect(out).toContain('Leave league');
    expect(out).not.toContain('Yes, leave');
  });

  it('asks to confirm before leaving', () => {
    const out = renderToStaticMarkup(h(LeagueMeCardView, { ...base, confirming: true }));
    expect(out).toContain(leaveConfirmText('Habich Fam').replace(/"/g, '&quot;'));
    expect(out).toContain('Yes, leave');
    expect(out).toContain('Cancel');
    expect(out).not.toContain('>Leave league<');
  });

  it('shows the server message, e.g. the last-commissioner 409', () => {
    const text = 'A league needs at least one commissioner. Make someone else commissioner first.';
    const out = renderToStaticMarkup(h(LeagueMeCardView, { ...base, message: { tone: 'danger', text } }));
    expect(out).toContain(text);
    expect(out).toContain('role="alert"');
  });

  it('confirm text says history stays', () => {
    expect(leaveConfirmText('Habich Fam')).toBe(
      'Leave Habich Fam? If you have picks, you stay in past standings marked "(left)". You can only rejoin as a new player.',
    );
  });
});

describe('league page: the card and "(left)" names', () => {
  let repo: Repo;
  let league: LeagueRow;

  beforeEach(async () => {
    repo = createMemoryRepo();
    hoisted.repo = repo;
    ({ league } = await seedLeague(repo, { signIn: false }));
    await repo.createPlayer(league.id, 'Grandpa'); // an unlinked former member
    setUser(null);
  });

  const page = async () =>
    renderToStaticMarkup((await LeaguePage({ params: Promise.resolve({ slug: league.slug }) })) as ReactElement);

  it('shows members their own card with their league name', async () => {
    await signInAsMember(repo, league, 'Mom');
    const out = await page();
    expect(out).toContain('You in this league');
    expect(out).toContain('value="Mom"');
  });

  it('shows no card to signed-out visitors or signed-in non-members', async () => {
    expect(await page()).not.toContain('You in this league');
    setUser(await makeUser(repo, 'Stranger'));
    expect(await page()).not.toContain('You in this league');
  });

  it('marks unlinked former members as "(left)" in public standings, and not linked members', async () => {
    const out = await page();
    expect(out).toContain('Grandpa (left)');
    expect(out).toContain('Commish');
    expect(out).not.toContain('Commish (left)');
  });

  it('says players join with the invite code (not that the commissioner adds them)', async () => {
    const empty = await seedLeague(repo, { slug: 'empty-fam-cccccc', signIn: false });
    await repo.deletePlayer(empty.commissioner.id);
    const out = renderToStaticMarkup(
      (await LeaguePage({ params: Promise.resolve({ slug: empty.league.slug }) })) as ReactElement,
    );
    expect(out).not.toContain('The commissioner adds them');
    expect(out).toContain('No players yet — people join with the league&#x27;s invite code.');
  });
});
