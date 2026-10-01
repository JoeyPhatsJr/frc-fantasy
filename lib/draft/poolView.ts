import type { PoolEntry } from '@/lib/pool/entries';

export type PoolSort = 'proj' | 'opr' | 'number';

function numberParts(teamKey: string): [number, string] {
  const m = /^frc([0-9]+)([A-Z]?)$/.exec(teamKey);
  return m ? [Number(m[1]), m[2]] : [Number.MAX_SAFE_INTEGER, teamKey];
}
const byNumber = (a: PoolEntry, b: PoolEntry) => {
  const [an, as] = numberParts(a.teamKey);
  const [bn, bs] = numberParts(b.teamKey);
  return an - bn || as.localeCompare(bs);
};
/** Higher first; missing values last; then team number. */
const byStat = (pick: (e: PoolEntry) => number | null) => (a: PoolEntry, b: PoolEntry) => {
  const x = pick(a);
  const y = pick(b);
  if (x !== null && y !== null && x !== y) return y - x;
  if ((x === null) !== (y === null)) return x === null ? 1 : -1;
  return byNumber(a, b);
};

/**
 * Spec §6.3: search by number prefix or nickname; sort by Proj (default, "New" last), OPR, or number;
 * "Available only" hides teams taken so far. `taken` comes from the live draft state, not the pool fetch,
 * so the list is right between pool reloads.
 */
export function filterSortPool(
  entries: PoolEntry[],
  opts: { query: string; sort: PoolSort; availableOnly: boolean; taken: Set<string> },
): PoolEntry[] {
  const q = opts.query.trim().toLowerCase();
  const rows = entries
    .map((e) => ({ ...e, available: !opts.taken.has(e.teamKey) }))
    .filter((e) => !opts.availableOnly || e.available)
    .filter(
      (e) => q === '' || e.teamKey.slice(3).toLowerCase().startsWith(q) || (e.nickname ?? '').toLowerCase().includes(q),
    );
  const compare = opts.sort === 'proj' ? byStat((e) => e.proj) : opts.sort === 'opr' ? byStat((e) => e.opr) : byNumber;
  return rows.sort(compare);
}
