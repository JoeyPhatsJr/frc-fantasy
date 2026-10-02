import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// LeagueHeaderView renders the stateful ⋯ menu, which asks for the router.
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
import { BottomBarView } from '@/components/shell/BottomBar';
import { AppHeader } from '@/components/shell/AppHeader';
import { AppearanceControlView } from '@/components/you/AppearanceControl';
import { LeagueHeaderView } from '@/components/shell/LeagueHeader';
import { LeagueSwitcherView } from '@/components/shell/LeagueSwitcher';

const r = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

// Next's <Link> may render aria-current before href, so match attribute order-agnostically.
const activeLink = (html: string, href: string) =>
  new RegExp(`<a(?=[^>]*href="${href}")(?=[^>]*aria-current="page")[^>]*>`).test(html);

describe('BottomBarView', () => {
  it('has Home, Leagues and You, fixed to the bottom with safe-area padding', () => {
    const html = r(h(BottomBarView, { pathname: '/' }));
    expect(html).toContain('aria-label="App"');
    for (const [label, href] of [['Home', '/'], ['Leagues', '/leagues'], ['You', '/you']]) {
      expect(html).toContain(`href="${href}"`);
      expect(html).toContain(label);
    }
    expect(html).toContain('fixed inset-x-0 bottom-0');
    expect(html).toContain('env(safe-area-inset-bottom)');
  });
  it('stays on league pages, with Leagues active', () => {
    const html = r(h(BottomBarView, { pathname: '/l/fam/r/1' }));
    expect(activeLink(html, '/leagues')).toBe(true);
    expect(activeLink(html, '/')).toBe(false);
  });
  it('marks You active on /you', () => {
    expect(activeLink(r(h(BottomBarView, { pathname: '/you' })), '/you')).toBe(true);
  });
});

describe('AppHeader', () => {
  it('is the dark band with the wordmark linking home', () => {
    const html = r(h(AppHeader, { signedIn: true }));
    expect(html).toContain('bg-band');
    expect(html).toContain('href="/"');
    expect(html).toContain('FRC FANTASY');
    expect(html).not.toContain('Sign in');
  });
  it('shows Sign in when signed out', () => {
    expect(r(h(AppHeader, { signedIn: false }))).toContain('href="/signin"');
  });
});

describe('AppearanceControlView', () => {
  it('is a two-option radio group with the current theme checked', () => {
    const html = r(h(AppearanceControlView, { theme: 'dark', onChange: () => {} }));
    expect(html).toContain('role="radiogroup"');
    const radios = html.match(/<button[^>]*role="radio"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(radios).toHaveLength(2);
    expect(radios.find((b) => b.includes('Dark'))).toContain('aria-checked="true"');
    expect(radios.find((b) => b.includes('Light'))).toContain('aria-checked="false"');
  });
  it('renders both unchecked before mount', () => {
    const html = r(h(AppearanceControlView, { theme: null, onChange: () => {} }));
    expect(html).not.toContain('aria-checked="true"');
  });
});

const base = {
  slug: 'fam', name: 'Family League', format: 'event' as const, isCommissioner: false, isMember: true,
  myName: 'Joey', targetRoundId: 'r1', anyLive: false, myLeagues: [], pathname: '/l/fam',
};

describe('LeagueHeaderView', () => {
  it('shows the league name on the band with Standings · Event · Draft tabs', () => {
    const html = r(h(LeagueHeaderView, base));
    expect(html).toContain('bg-band');
    expect(html).toContain('Family League');
    expect(html).toContain('href="/l/fam"');
    expect(html).toContain('href="/l/fam/r/r1"');
    expect(html).toContain('href="/l/fam/draft"');
    expect(html).not.toContain('href="/l/fam/admin"');
  });
  it('adds Admin and the Commissioner label for commissioners', () => {
    const html = r(h(LeagueHeaderView, { ...base, isCommissioner: true }));
    expect(html).toContain('href="/l/fam/admin"');
    expect(html).toContain('Commissioner');
  });
  it('season leagues have no Event tab', () => {
    const html = r(h(LeagueHeaderView, { ...base, format: 'season' }));
    expect(html).not.toContain('href="/l/fam/r/r1"');
    expect(html).toContain('href="/l/fam/draft"');
  });
  it('marks the Draft tab active inside the draft room', () => {
    const html = r(h(LeagueHeaderView, { ...base, pathname: '/l/fam/r/r1/draft' }));
    expect(activeLink(html, '/l/fam/draft')).toBe(true);
    expect(activeLink(html, '/l/fam/r/r1')).toBe(false);
  });
  it('marks Standings active on the league home', () => {
    expect(activeLink(r(h(LeagueHeaderView, base)), '/l/fam')).toBe(true);
  });
  it('links Event to the empty-state round when the league has no rounds', () => {
    expect(r(h(LeagueHeaderView, { ...base, targetRoundId: null }))).toContain('href="/l/fam/r/none"');
  });
  it('signed-out viewers get no menu and no switcher', () => {
    const html = r(h(LeagueHeaderView, { ...base, isMember: false, myName: null, myLeagues: [{ slug: 'x', name: 'X' }] }));
    expect(html).not.toContain('aria-label="League menu"');
    expect(html).not.toContain('Switch');
  });
  it('members with no other leagues get the ⋯ menu but no Switch chip', () => {
    const html = r(h(LeagueHeaderView, base));
    expect(html).toContain('aria-label="League menu"');
    expect(html).not.toContain('Switch');
  });
  it('members with other leagues get a Switch chip and the ⋯ menu', () => {
    const html = r(h(LeagueHeaderView, { ...base, myLeagues: [{ slug: 'x', name: 'X' }] }));
    expect(html).toContain('Switch');
    expect(html).toContain('aria-label="League menu"');
  });
  it('shows the live dot only when a round is live', () => {
    expect(r(h(LeagueHeaderView, base))).not.toContain('data-live-dot');
    const html = r(h(LeagueHeaderView, { ...base, anyLive: true }));
    expect(html).toContain('data-live-dot');
    expect(html).toContain('A round is live');
  });
  it('truncates a very long league name', () => {
    const html = r(h(LeagueHeaderView, { ...base, name: 'The Extremely Long Habich Family And Friends Fantasy League' }));
    expect(html).toContain('truncate');
  });
});

describe('LeagueSwitcherView', () => {
  const leagues = [{ slug: 'robotics-club', name: 'Robotics Club' }];
  it('is a 44px chip that opens a dialog', () => {
    const html = r(h(LeagueSwitcherView, { leagues, open: false, onOpen: () => {}, onClose: () => {} }));
    expect(html).toContain('Switch');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('min-h-11');
    expect(html).not.toContain('Your leagues');
  });
  it('lists the other leagues plus All leagues when open', () => {
    const html = r(h(LeagueSwitcherView, { leagues, open: true, onOpen: () => {}, onClose: () => {} }));
    expect(html).toContain('Your leagues');
    expect(html).toContain('href="/l/robotics-club"');
    expect(html).toContain('Robotics Club');
    expect(html).toContain('href="/leagues"');
    expect(html).toContain('All leagues');
  });
});
