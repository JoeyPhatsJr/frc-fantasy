import { createHash } from 'node:crypto';
import type { CacheMeta } from '@/lib/db/types';
import type { ScoringConfig } from '@/lib/scoring/config';

/**
 * JSON with object keys sorted at every depth. Postgres jsonb stores keys in its own order, so the
 * same TBA body can come back with keys shuffled; hashing this form keeps the hash stable.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The tba_cache.body_hash value. Computed only inside the repos' upsertCache (spec §5.6). */
export function bodyHash(body: unknown): string | null {
  return body === null || body === undefined ? null : sha256Hex(canonicalJson(body));
}

export function configHash(config: ScoringConfig): string {
  return sha256Hex(canonicalJson(config));
}

/**
 * sha256 over "path=hash" lines in the given (fixed) path order. Fetch times are left out on
 * purpose: a 304 refresh moves fetched_at but not the data. Null when any path has no cache row,
 * because then there is nothing trustworthy to compare against.
 */
export function sourceStamp(paths: string[], meta: Map<string, CacheMeta>): string | null {
  const lines: string[] = [];
  for (const path of paths) {
    const m = meta.get(path);
    if (!m) return null;
    lines.push(`${path}=${m.bodyHash ?? 'null'}`);
  }
  return sha256Hex(lines.join('\n'));
}
