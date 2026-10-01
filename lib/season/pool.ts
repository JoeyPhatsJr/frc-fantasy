import type { PoolFilter } from '@/lib/season/poolFilter';
import { getTba } from '@/lib/tba/client';
import type { TeamSimple } from '@/lib/tba/types';

const DAY_MS = 24 * 60 * 60_000;
/** TBA pages hold 500 teams; 40 pages is far more than FRC has, and stops a runaway loop. */
const MAX_PAGES = 40;
/** Pages fetched at once (final review I6): ~22 pages become ~6 round trips instead of 22. */
const PAGE_BATCH = 4;

export function seasonEmptyMessage(year: number): string {
  return `TBA hasn't published ${year} teams yet — usually by January.`;
}

/**
 * Every team for the year, in page order. Pages are fetched PAGE_BATCH at a time; the walk ends with
 * the batch that holds the first empty (or missing) page, and pages after that one are ignored, so the
 * result matches a one-page-at-a-time walk that stops at the first empty page (spec §5.5).
 */
async function allTeams(year: number): Promise<{ teams: TeamSimple[]; stale: boolean }> {
  const teams: TeamSimple[] = [];
  let stale = false;
  for (let start = 0; start < MAX_PAGES; start += PAGE_BATCH) {
    const pages = Array.from({ length: Math.min(PAGE_BATCH, MAX_PAGES - start) }, (_, i) => start + i);
    const results = await Promise.all(
      pages.map((page) => getTba<TeamSimple[]>(`/teams/${year}/${page}/simple`, { windowMs: DAY_MS })),
    );
    for (const res of results) {
      stale ||= res.stale;
      if (!Array.isArray(res.data) || res.data.length === 0) return { teams, stale };
      teams.push(...res.data);
    }
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
