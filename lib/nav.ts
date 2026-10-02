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

/** The live-draft pill steps aside where it would be redundant or in the way (spec §5.5). */
export function showLiveDraftPill(pathname: string): boolean {
  const p = trim(pathname);
  if (p === '/signin') return false;
  return !/^\/l\/[^/]+(\/r\/[^/]+)?\/draft$/.test(p);
}

/** @deprecated removed in Task 17 — old league TabBar/AppTabBar only. */
export function activeTab(pathname: string, slug: string): 'standings' | 'round' | 'admin' | null {
  const t = leagueTab(pathname, slug);
  return t === 'event' ? 'round' : t === 'draft' ? 'round' : t;
}
/** @deprecated removed in Task 17. */
export function showAppTabBar(pathname: string): boolean {
  return !pathname.startsWith('/l/');
}
