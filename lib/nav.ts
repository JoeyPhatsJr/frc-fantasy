import type { LeagueFormat } from '@/lib/db/types';

const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

export type AppTab = 'home' | 'leagues' | 'you';

/** Which bottom-bar tab a path belongs to (spec §5.2). Every league page counts as Leagues. */
export function appTab(pathname: string): AppTab | null {
  const p = trim(pathname);
  if (p === '/') return 'home';
  if (p === '/you' || p === '/me/settings') return 'you';
  if (p === '/leagues' || p.startsWith('/leagues/') || p.startsWith('/join/') || p.startsWith('/l/')) return 'leagues';
  return null;
}

export type LeagueTab = 'standings' | 'event' | 'draft' | 'admin';

export const LEAGUE_TAB_LABEL: Record<LeagueTab, string> = {
  standings: 'Standings',
  event: 'Event',
  draft: 'Draft',
  admin: 'Admin',
};

/** Which league tab a path belongs to, or null outside this league (spec §5.4). */
export function leagueTab(pathname: string, slug: string): LeagueTab | null {
  const base = `/l/${slug}`;
  const p = trim(pathname);
  if (p === base) return 'standings';
  if (!p.startsWith(`${base}/`)) return null;
  const parts = p.slice(base.length + 1).split('/');
  if (parts[0] === 'admin') return 'admin';
  if (parts[0] === 'draft') return 'draft';
  if (parts[0] === 'r') return parts[2] === 'draft' ? 'draft' : 'event';
  return null;
}

/** Full-season leagues have no Event tab: the season is the standings (spec §6.4). */
export function leagueTabs(format: LeagueFormat, isCommissioner: boolean): LeagueTab[] {
  const tabs: LeagueTab[] = format === 'season' ? ['standings', 'draft'] : ['standings', 'event', 'draft'];
  return isCommissioner ? [...tabs, 'admin'] : tabs;
}

export function leagueTabHref(tab: LeagueTab, slug: string, targetRoundId: string | null): string {
  const base = `/l/${encodeURIComponent(slug)}`;
  switch (tab) {
    case 'standings':
      return base;
    case 'event':
      return `${base}/r/${targetRoundId ?? 'none'}`;
    case 'draft':
      return `${base}/draft`;
    case 'admin':
      return `${base}/admin`;
  }
}

/**
 * The live-draft pill steps aside where it would be redundant or in the way (spec §5.5): draft pages,
 * sign-in, and Home, whose Up next card always leads with a live draft (lib/views/upNext.ts).
 */
export function showLiveDraftPill(pathname: string): boolean {
  const p = trim(pathname);
  if (p === '/' || p === '/signin') return false;
  return !/^\/l\/[^/]+(\/r\/[^/]+)?\/draft$/.test(p);
}

/** The header's "Sign in" button is pointless on the sign-in page itself. */
export function showHeaderSignIn(pathname: string): boolean {
  return trim(pathname) !== '/signin';
}

/**
 * Bottom padding for the root footer: signed in it clears the fixed bottom bar, and with a live draft the
 * gold pill floating above the bar too (pill top edge ≈ 116px up), so it never covers the footer's link.
 */
export function footerPadding(signedIn: boolean, pill: boolean): 'pb-6' | 'pb-24' | 'pb-36' {
  if (!signedIn) return 'pb-6';
  return pill ? 'pb-36' : 'pb-24';
}
