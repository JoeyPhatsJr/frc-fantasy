import { describe, expect, it } from 'vitest';
import { appTab, footerPadding, leagueTab, leagueTabHref, leagueTabs, showLiveDraftPill } from '@/lib/nav';

describe('appTab', () => {
  it('home is the root only', () => {
    expect(appTab('/')).toBe('home');
  });
  it('leagues covers the list, create, join and every league page', () => {
    for (const p of ['/leagues', '/leagues/new', '/join/ABC123', '/l/fam', '/l/fam/r/1', '/l/fam/r/1/draft', '/l/fam/draft', '/l/fam/admin/r/1']) {
      expect(appTab(p), p).toBe('leagues');
    }
  });
  it('you covers /you and the old settings path', () => {
    expect(appTab('/you')).toBe('you');
    expect(appTab('/you/')).toBe('you');
    expect(appTab('/me/settings')).toBe('you');
  });
  it('is null for sign-in and unknown pages', () => {
    expect(appTab('/signin')).toBeNull();
    expect(appTab('/younger')).toBeNull();
    expect(appTab('/leaguesx')).toBeNull();
  });
});

describe('leagueTab', () => {
  it('maps each league path to its tab', () => {
    expect(leagueTab('/l/fam', 'fam')).toBe('standings');
    expect(leagueTab('/l/fam/', 'fam')).toBe('standings');
    expect(leagueTab('/l/fam/r/abc', 'fam')).toBe('event');
    expect(leagueTab('/l/fam/r/abc/draft', 'fam')).toBe('draft');
    expect(leagueTab('/l/fam/draft', 'fam')).toBe('draft');
    expect(leagueTab('/l/fam/admin', 'fam')).toBe('admin');
    expect(leagueTab('/l/fam/admin/r/abc', 'fam')).toBe('admin');
  });
  it('is null outside this league and matches slugs literally', () => {
    expect(leagueTab('/', 'fam')).toBeNull();
    expect(leagueTab('/l/fam-2', 'fam')).toBeNull();
    expect(leagueTab('/l/fam/administrator', 'fam')).toBeNull();
    expect(leagueTab('/l/a.b', 'a.b')).toBe('standings');
    expect(leagueTab('/l/axb', 'a.b')).toBeNull();
  });
});

describe('leagueTabs', () => {
  it('event leagues have an Event tab; season leagues do not', () => {
    expect(leagueTabs('event', false)).toEqual(['standings', 'event', 'draft']);
    expect(leagueTabs('event', true)).toEqual(['standings', 'event', 'draft', 'admin']);
    expect(leagueTabs('season', false)).toEqual(['standings', 'draft']);
    expect(leagueTabs('season', true)).toEqual(['standings', 'draft', 'admin']);
  });
});

describe('leagueTabHref', () => {
  it('points Event at the target round, or the standings when there is none', () => {
    expect(leagueTabHref('event', 'fam', 'r1')).toBe('/l/fam/r/r1');
    expect(leagueTabHref('event', 'fam', null)).toBe('/l/fam/r/none');
    expect(leagueTabHref('draft', 'fam', 'r1')).toBe('/l/fam/draft');
    expect(leagueTabHref('standings', 'fam', null)).toBe('/l/fam');
    expect(leagueTabHref('admin', 'fam', null)).toBe('/l/fam/admin');
  });
  it('encodes the slug', () => {
    expect(leagueTabHref('standings', 'a b', null)).toBe('/l/a%20b');
  });
});

describe('showLiveDraftPill', () => {
  it('hides on draft pages and the sign-in page only', () => {
    expect(showLiveDraftPill('/')).toBe(true);
    expect(showLiveDraftPill('/l/fam')).toBe(true);
    expect(showLiveDraftPill('/l/fam/draft')).toBe(false);
    expect(showLiveDraftPill('/l/fam/r/1/draft')).toBe(false);
    expect(showLiveDraftPill('/signin')).toBe(false);
  });
});

describe('footerPadding', () => {
  it('clears the bottom bar when signed in, and the live-draft pill above it too', () => {
    expect(footerPadding(false, false)).toBe('pb-6');
    expect(footerPadding(true, false)).toBe('pb-24');
    // Task 18 screenshots: with pb-24 the pill (72px up, 44px tall) covered the "Data from The Blue Alliance" link.
    expect(footerPadding(true, true)).toBe('pb-36');
  });
});
