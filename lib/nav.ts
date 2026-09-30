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
