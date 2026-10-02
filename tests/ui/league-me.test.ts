import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => hoisted.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
vi.mock('@/lib/tba/client', () => ({ getTba: async () => ({ data: null, fetchedAt: null, stale: false }) }));
// AutoRefresh renders nothing; swap in a marker so the page's refresh choice shows in the markup.
vi.mock('@/components/AutoRefresh', async () => {
  const { createElement } = await import('react');
  return { AutoRefresh: ({ seconds }: { seconds: number }) => createElement('i', { 'data-auto-refresh': seconds }) };
});
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  usePathname: () => '/',
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

import LeaguePage from '@/app/l/[slug]/page';
import { LeagueMenuView, leaveConfirmText } from '@/components/shell/LeagueMenu';
import type { SessionUser } from '@/lib/auth/session';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
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

const menuBase = {
  ...base,
  open: true,
  onOpen: noop,
  onClose: noop,
  leagueUrl: 'https://frc-fantasy-5181.vercel.app/l/habich-fam-abc234',
} as const;

describe('LeagueMenuView (spec §5.3: the ⋯ menu takes over "You in this league")', () => {
  it('is a 44px ⋯ button that opens a dialog, closed by default', () => {
    const out = renderToStaticMarkup(h(LeagueMenuView, { ...menuBase, open: false }));
    expect(out).toContain('aria-label="League menu"');
    expect(out).toContain('aria-haspopup="dialog"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('size-11');
    expect(out).not.toContain('role="dialog"');
  });

  it('opens a sheet titled with the league name: rename, copy link, leave', () => {
    const out = renderToStaticMarkup(h(LeagueMenuView, menuBase));
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain('Habich Fam');
    expect(out).toContain('Your name in this league');
    expect(out).toContain('value="Joey Habich"');
    expect(out).toContain('maxLength="40"');
    expect(out).toContain('Save name');
    expect(out).toContain('Copy league link');
    expect(out).toContain('frc-fantasy-5181.vercel.app/l/habich-fam-abc234');
    expect(out).toContain('Leave league');
    expect(out).not.toContain('Yes, leave');
  });

  it('asks to confirm before leaving', () => {
    const out = renderToStaticMarkup(h(LeagueMenuView, { ...menuBase, confirming: true }));
    expect(out).toContain(leaveConfirmText('Habich Fam').replace(/"/g, '&quot;'));
    expect(out).toContain('Yes, leave');
    expect(out).toContain('Cancel');
    expect(out).not.toContain('>Leave league<');
  });

  it('shows the server message, e.g. the last-commissioner 409', () => {
    const text = 'A league needs at least one commissioner. Make someone else commissioner first.';
    const out = renderToStaticMarkup(h(LeagueMenuView, { ...menuBase, message: { tone: 'danger', text } }));
    expect(out).toContain(text);
    expect(out).toContain('role="alert"');
  });

  it('disables Save while unchanged, and every action while busy', () => {
    const unchanged = renderToStaticMarkup(h(LeagueMenuView, { ...menuBase, saveDisabled: true }));
    expect(unchanged).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*disabled="")[^>]*>/);
    const saving = renderToStaticMarkup(h(LeagueMenuView, { ...menuBase, busy: 'save' }));
    expect(saving).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*aria-busy="true")[^>]*>/);
    expect(saving).toMatch(/<button(?=[^>]*disabled="")[^>]*>\s*Leave league/);
    const leaving = renderToStaticMarkup(h(LeagueMenuView, { ...menuBase, confirming: true, busy: 'leave' }));
    expect(leaving).toMatch(/<button(?=[^>]*aria-busy="true")[^>]*>[\s\S]*?Yes, leave/);
  });
});

describe('league page: standings and "(left)" names (spec §6.3)', () => {
  let repo: Repo;
  let league: LeagueRow;
  let commish: SessionUser;

  beforeEach(async () => {
    repo = createMemoryRepo();
    hoisted.repo = repo;
    ({ league, user: commish } = await seedLeague(repo, { signIn: false }));
    await repo.createPlayer(league.id, 'Grandpa'); // an unlinked former member
    setUser(null);
  });

  const page = async (slug = league.slug) =>
    renderToStaticMarkup((await LeaguePage({ params: Promise.resolve({ slug }) })) as ReactElement);

  it('no longer shows the "You in this league" card, even to members (the ⋯ menu has it)', async () => {
    await signInAsMember(repo, league, 'Mom');
    const out = await page();
    expect(out).not.toContain('You in this league');
    expect(out).toContain('Mom (you)');
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

  it('says to share the invite code (not that the commissioner adds them)', async () => {
    const empty = await seedLeague(repo, { slug: 'empty-fam-cccccc', signIn: false });
    await repo.deletePlayer(empty.commissioner.id);
    const out = await page(empty.league.slug);
    expect(out).not.toContain('The commissioner adds them');
    expect(out).toContain('No players yet — share the invite code from Admin.');
  });

  it('no events: a "No events yet" strip and empty state; commissioners get the Admin link', async () => {
    let out = await page();
    expect(out).toContain('role="status"');
    expect(out.match(/No events yet/g)?.length).toBeGreaterThanOrEqual(2);
    expect(out).not.toContain('Add one in Admin');
    setUser(commish);
    out = await page();
    expect(out).toContain('Add one in Admin');
    expect(out).toContain(`href="/l/${league.slug}/admin"`);
  });

  it('event leagues: progress strip, season leaderboard by event, and the Events list', async () => {
    const round = await repo.createRound({
      leagueId: league.id, eventKey: '2026parr', eventName: 'Ramp Riot', startDate: '2026-10-24',
      endDate: '2026-10-24', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    const out = await page();
    expect(out).toContain('1 event · 1 to go');
    expect(out).toContain('Standings');
    expect(out).toContain('Events');
    expect(out).toContain(`href="/l/${league.slug}/r/${round.id}"`);
    expect(out).toContain('Ramp Riot');
    expect(out).not.toContain('Live now');
    expect(out).not.toContain('Small numbers are points per round');
    expect(out).not.toContain('See rosters');
  });

  it('waits for a live draft by refreshing every 30 s (spec §5.5: the pill is in the layout)', async () => {
    const round = await repo.createRound({
      leagueId: league.id, eventKey: '2026parr', eventName: 'Ramp Riot', startDate: '2026-10-24',
      endDate: '2026-10-24', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    // A hand-entered draft never shows the pill, so nothing to wait for.
    expect(await page()).not.toContain('data-auto-refresh');
    await repo.updateRound(round.id, { draftMode: 'live' });
    const out = await page();
    expect(out.match(/data-auto-refresh/g)).toHaveLength(1);
    expect(out).toContain('data-auto-refresh="30"');
  });

  it('full-season leagues show the current season round with the Event layout', async () => {
    const season = await seedLeague(repo, { slug: 'season-fam-dddddd', format: 'season', signIn: false });
    await repo.createRound({
      leagueId: season.league.id, kind: 'season', eventKey: null, seasonYear: 2027, eventName: '2027 Season',
      startDate: '2027-01-01', endDate: '2027-12-31', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    const out = await page(season.league.slug);
    expect(out).toContain('role="status"');
    expect(out).toContain('Leaderboard');
    expect(out).toContain('How scoring works');
    expect(out).toContain('Draft not set up yet');
    expect(out).not.toContain('>Standings<');
    expect(out).not.toContain(' to go');
  });

  it('full-season leagues with no season yet show the empty state', async () => {
    const season = await seedLeague(repo, { slug: 'season-fam-eeeeee', format: 'season', signIn: false });
    const out = await page(season.league.slug);
    expect(out).toContain('No events yet');
    expect(out).not.toContain('Leaderboard');
  });
});
