import type { RoundKind } from '@/lib/db/types';
import type { RoundStatus } from '@/lib/rounds/status';
import { DEFAULT_POOL_FILTER, type PoolFilter } from '@/lib/season/poolFilter';

// Pure: no server imports, so the admin dashboard (a client component) can use it.

/** "Start {year + 1} season" shows once the latest season round is Final (spec §5.5). */
export function nextSeasonYear(
  rounds: { kind: RoundKind; seasonYear: number | null; status: RoundStatus }[],
): number | null {
  const seasons = rounds.filter((r) => r.kind === 'season' && r.seasonYear !== null);
  if (seasons.length === 0) return null;
  const latest = seasons.reduce((a, b) => (b.seasonYear! > a.seasonYear! ? b : a));
  return latest.status === 'final' ? latest.seasonYear! + 1 : null;
}

/** District keys carry their year (2027fma); the same district next season is 2028fma. */
export function nextPoolFilter(filter: PoolFilter | null, year: number): PoolFilter {
  if (!filter) return DEFAULT_POOL_FILTER;
  return filter.type === 'district' ? { type: 'district', key: `${year}${filter.key.slice(4)}` } : filter;
}
