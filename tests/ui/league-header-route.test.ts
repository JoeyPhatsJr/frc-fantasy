import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ repo: undefined as unknown, pathname: '/' }));
vi.mock('@/lib/db', () => ({ getRepo: () => hoisted.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  usePathname: () => hoisted.pathname,
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

import LeagueLayout from '@/app/l/[slug]/layout';
import DraftTabPage from '@/app/l/[slug]/draft/page';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { makeUser, setUser, signInAsMember } from '../helpers/auth';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;

beforeEach(async () => {
  repo = createMemoryRepo();
  hoisted.repo = repo;
  ({ league } = await seedLeague(repo, { signIn: false }));
  setUser(null);
  hoisted.pathname = `/l/${league.slug}`;
});

const layout = async (slug = league.slug) =>
  renderToStaticMarkup(
    (await LeagueLayout({ children: h('p', null, 'PAGE'), params: Promise.resolve({ slug }) })) as ReactElement,
  );

const addRound = (startDate: string) =>
  repo.createRound({
    leagueId: league.id, kind: 'manual', eventKey: null, eventName: 'Ramp Riot', startDate, endDate: startDate,
    timezone: 'America/New_York', scoring: defaultScoring(),
  });

describe('league layout: the band header', () => {
  it('signed-out visitors of a link league see the name and tabs, but no menu or switcher', async () => {
    const out = await layout();
    expect(out).toContain('Habich Fam');
    expect(out).toContain(`href="/l/${league.slug}/draft"`);
    expect(out).toContain(`href="/l/${league.slug}/r/none"`);
    expect(out).not.toContain('aria-label="League menu"');
    expect(out).not.toContain('Switch');
    expect(out).toContain('PAGE');
  });

  it('members get the ⋯ menu; the Switch chip appears once they are in another league', async () => {
    const { user } = await signInAsMember(repo, league, 'Mom');
    let out = await layout();
    expect(out).toContain('aria-label="League menu"');
    expect(out).not.toContain('Switch');

    const other = await seedLeague(repo, { name: 'Robotics Club', slug: 'robotics-club-dddddd', signIn: false });
    await repo.createMember({ leagueId: other.league.id, userId: user.id, name: 'Mom', role: 'player' });
    out = await layout();
    expect(out).toContain('Switch');
    expect(out).not.toContain('Robotics Club'); // the list is inside the closed sheet
  });

  it('signed-in non-members of a link league get no menu', async () => {
    setUser(await makeUser(repo, 'Stranger'));
    expect(await layout()).not.toContain('aria-label="League menu"');
  });

  it('Event points at the target round once the league has one', async () => {
    const round = await addRound('2026-10-24');
    expect(await layout()).toContain(`href="/l/${league.slug}/r/${round.id}"`);
  });

  it('full-season leagues have no Event tab', async () => {
    const season = await seedLeague(repo, { slug: 'season-fam-eeeeee', format: 'season', signIn: false });
    const out = await layout(season.league.slug);
    expect(out).toContain(`href="/l/${season.league.slug}/draft"`);
    expect(out).not.toContain(`href="/l/${season.league.slug}/r/`);
  });

  it('still renders the page when the switcher lookup fails (Review Focus 5)', async () => {
    await signInAsMember(repo, league, 'Mom');
    repo.listLeaguesForUser = async () => {
      throw new Error('db hiccup');
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await layout();
    spy.mockRestore();
    expect(out).toContain('aria-label="League menu"');
    expect(out).not.toContain('Switch');
    expect(out).toContain('PAGE');
  });

  it('members-only leagues show non-members the page bare (no header)', async () => {
    const priv = await seedLeague(repo, { slug: 'secret-fam-ffffff', visibility: 'members', signIn: false });
    const out = await layout(priv.league.slug);
    expect(out).not.toContain('bg-band');
    expect(out).toBe('<p>PAGE</p>');
  });
});

describe('/l/[slug]/draft (the Draft tab)', () => {
  const page = async (slug = league.slug) =>
    renderToStaticMarkup((await DraftTabPage({ params: Promise.resolve({ slug }) })) as ReactElement);

  it('says there are no drafts yet when the league has no rounds', async () => {
    const out = await page();
    expect(out).toContain('No drafts yet');
    expect(out).toContain('When the commissioner adds an event, its draft shows up here.');
  });

  it("redirects to the target round's draft room", async () => {
    const round = await addRound('2026-10-24');
    await expect(page()).rejects.toThrow(`NEXT_REDIRECT /l/${league.slug}/r/${round.id}/draft`);
  });

  it('404s for an unknown league', async () => {
    await expect(page('nope-zzzzzz')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows the private card to non-members of a members-only league', async () => {
    const priv = await seedLeague(repo, { slug: 'secret-fam-ffffff', visibility: 'members', signIn: false });
    await addRound('2026-10-24');
    const out = await page(priv.league.slug);
    expect(out).toContain('Private league');
  });
});
