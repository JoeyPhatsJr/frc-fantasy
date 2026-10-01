import type { PoolFilter } from '@/lib/season/poolFilter';
import { getTba } from '@/lib/tba/client';
import type { TeamSimple } from '@/lib/tba/types';

const DAY_MS = 24 * 60 * 60_000;
/** TBA pages hold 500 teams; 40 pages is far more than FRC has, and stops a runaway loop. */
const MAX_PAGES = 40;

export function seasonEmptyMessage(year: number): string {
  return `TBA hasn't published ${year} teams yet — usually by January.`;
}

async function allTeams(year: number): Promise<{ teams: TeamSimple[]; stale: boolean }> {
  const teams: TeamSimple[] = [];
  let stale = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await getTba<TeamSimple[]>(`/teams/${year}/${page}/simple`, { windowMs: DAY_MS });
    stale ||= res.stale;
    if (!Array.isArray(res.data) || res.data.length === 0) break;
    teams.push(...res.data);
  }
  return { teams, stale };
}

const same = (a: string | null | undefined, b: string) => (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The TBA side of a season round's pool (spec §5.5). Manual extra teams are merged by loadPool.
 * `published` is false when TBA has no teams at all for the year (or district), so an empty pool can
 * be blamed on TBA's calendar rather than on a filter that matches nobody.
 */
export async function loadSeasonTbaTeams(
  year: number,
  filter: PoolFilter,
): Promise<{ teams: TeamSimple[]; stale: boolean; published: boolean }> {
  if (filter.type === 'district') {
    const res = await getTba<TeamSimple[]>(`/district/${filter.key}/teams/simple`, { windowMs: DAY_MS });
    const teams = Array.isArray(res.data) ? res.data : [];
    return { teams, stale: res.stale, published: teams.length > 0 };
  }
  const all = await allTeams(year);
  const published = all.teams.length > 0;
  if (filter.type === 'all') return { ...all, published };
  return {
    teams: all.teams.filter(
      (t) => same(t.country, filter.country) && (filter.type === 'country' || same(t.state_prov, filter.state)),
    ),
    stale: all.stale,
    published,
  };
}
