import { getRepo } from '@/lib/db';
import type { CacheRow } from '@/lib/db/types';

const TBA_BASE = 'https://www.thebluealliance.com/api/v3';
const TIMEOUT_MS = 5_000;
const FORCE_MIN_AGE_MS = 15_000;

export type TbaResult<T> = { data: T | null; fetchedAt: string | null; stale: boolean };

export interface CacheStore {
  getCache(path: string): Promise<CacheRow | null>;
  upsertCache(row: CacheRow): Promise<void>;
}

export type TbaDeps = {
  store: CacheStore;
  fetchImpl: typeof fetch;
  now: () => Date;
  apiKey: string | undefined;
};

/**
 * Reads one TBA endpoint through the tba_cache table (spec §7.3).
 * Never throws for TBA problems: it returns the last good data with stale = true.
 * `deps` exists so tests can pass a fake store, fetch, and clock.
 */
export async function getTba<T>(
  path: string,
  opts: { windowMs: number; force?: boolean },
  deps: Partial<TbaDeps> = {},
): Promise<TbaResult<T>> {
  if (!path.startsWith('/')) throw new Error(`TBA path must start with "/": ${path}`);

  const store = deps.store ?? getRepo();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = (deps.now ?? (() => new Date()))();
  const apiKey = 'apiKey' in deps ? deps.apiKey : process.env.TBA_API_KEY;

  const row = await store.getCache(path);
  if (row) {
    const age = now.getTime() - Date.parse(row.fetchedAt);
    const fresh = opts.force ? age < FORCE_MIN_AGE_MS : age < opts.windowMs;
    if (fresh) return { data: row.body as T | null, fetchedAt: row.fetchedAt, stale: false };
  }

  const failed = async (message: string): Promise<TbaResult<T>> => {
    if (!row) return { data: null, fetchedAt: null, stale: true };
    await store.upsertCache({ ...row, lastError: message, lastErrorAt: now.toISOString() });
    return { data: row.body as T | null, fetchedAt: row.fetchedAt, stale: true };
  };

  if (!apiKey) return failed('TBA_API_KEY is not set');

  let res: Response;
  try {
    const headers: Record<string, string> = { 'X-TBA-Auth-Key': apiKey, Accept: 'application/json' };
    if (row?.etag) headers['If-None-Match'] = row.etag;
    res = await fetchImpl(`${TBA_BASE}${path}`, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return failed('TBA timed out');
    return failed(`TBA request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const fetchedAt = now.toISOString();
  const save = async (etag: string | null, body: unknown | null): Promise<TbaResult<T>> => {
    await store.upsertCache({ path, etag, body, fetchedAt, lastError: null, lastErrorAt: null });
    return { data: body as T | null, fetchedAt, stale: false };
  };

  if (res.status === 304 && row) return save(row.etag, row.body);
  if (res.status === 404) return save(null, null);
  if (res.status === 200) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return failed('TBA sent a response that was not JSON');
    }
    return save(res.headers.get('etag'), body ?? null);
  }
  return failed(`TBA returned HTTP ${res.status}`);
}
