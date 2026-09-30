export type LeagueTab = 'standings' | 'round' | 'admin';

/** Which league tab a path belongs to, or null when the path is outside this league. */
export function activeTab(pathname: string, slug: string): LeagueTab | null {
  const base = `/l/${slug}`;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === base) return 'standings';
  if (!path.startsWith(`${base}/`)) return null;
  const first = path.slice(base.length + 1).split('/')[0];
  if (first === 'r') return 'round';
  if (first === 'admin') return 'admin';
  return null;
}

export type AppTab = 'me' | 'leagues';

/** The signed-in app's bottom tabs (spec §4.6). null = not an app-tab page. */
export function appTab(pathname: string): AppTab | null {
  if (pathname === '/' || pathname === '/me' || pathname.startsWith('/me/')) return 'me';
  if (pathname === '/leagues' || pathname.startsWith('/leagues/') || pathname.startsWith('/join/')) return 'leagues';
  return null;
}

/** League pages keep their own bottom TabBar, so the app bar steps aside there (plan deviation 1). */
export function showAppTabBar(pathname: string): boolean {
  return !pathname.startsWith('/l/');
}
