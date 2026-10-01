import { getRepo } from '@/lib/db';
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
async function walkPages(year: number): Promise<{ teams: TeamSimple[]; stale: boolean; fetchedAt: string[] }> {
  const teams: TeamSimple[] = [];
  const fetchedAt: string[] = [];
  let stale = false;
  for (let start = 0; start < MAX_PAGES; start += PAGE_BATCH) {
    const pages = Array.from({ length: Math.min(PAGE_BATCH, MAX_PAGES - start) }, (_, i) => start + i);
    const results = await Promise.all(
      pages.map((page) => getTba<TeamSimple[]>(`/teams/${year}/${page}/simple`, { windowMs: DAY_MS })),
    );
    for (const res of results) {
      stale ||= res.stale;
      if (res.fetchedAt) fetchedAt.push(res.fetchedAt);
      if (!Array.isArray(res.data) || res.data.length === 0) return { teams, stale, fetchedAt };
      teams.push(...res.data);
    }
  }
  return { teams, stale, fetchedAt };
}

/**
 * The tba_cache row holding a slim copy of every team for the year (final review I6). It is derived
 * from the /teams/{year}/{page}/simple rows, not a TBA path, so getTba never fetches it.
 */
export function seasonTeamsCachePath(year: number): string {
  return `derived:season-teams/${year}`;
}

/** Only what the pool (key, nickname) and its filters (country, state) use: no sponsor names or city. */
const slim = (t: TeamSimple): TeamSimple => ({
  key: t.key,
  team_number: t.team_number,
  nickname: t.nickname ?? null,
  state_prov: t.state_prov ?? null,
  country: t.country ?? null,
});

/**
 * Every team for the year. Reading ~22 full pages (~1 MB of tba_cache) on every admin poll and pick
 * was the cost in final review I6, so a fresh slim copy is one small read instead. The copy is dated by
 * its oldest page and expires on the same 24 h window, so it is never older than the pages would be.
 * It is saved only from a complete, non-stale walk that found teams.
 */
async function allTeams(year: number): Promise<{ teams: TeamSimple[]; stale: boolean }> {
  const repo = getRepo();
  const path = seasonTeamsCachePath(year);
  const copy = await repo.getCache(path);
  if (copy && Array.isArray(copy.body) && Date.now() - Date.parse(copy.fetchedAt) < DAY_MS) {
    return { teams: copy.body as TeamSimple[], stale: false };
  }

  const walked = await walkPages(year);
  const oldest = Math.min(...walked.fetchedAt.map((at) => Date.parse(at)));
  if (!walked.stale && walked.teams.length > 0 && Number.isFinite(oldest)) {
    try {
      await repo.upsertCache({
        path,
        etag: null,
        body: walked.teams.map(slim),
        fetchedAt: new Date(oldest).toISOString(),
        lastError: null,
        lastErrorAt: null,
      });
    } catch (err) {
      // The pool is still right; the next load just walks the pages again.
      console.error(`Could not cache the ${year} team list`, err);
    }
  }
  return { teams: walked.teams, stale: walked.stale };
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
