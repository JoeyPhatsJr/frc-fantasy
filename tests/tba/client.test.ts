import { describe, expect, it, vi } from 'vitest';
import type { CacheRow } from '@/lib/db/types';
import { getTba, type CacheStore } from '@/lib/tba/client';

const PATH = '/event/2025parr/rankings';
const NOW = new Date('2026-10-24T18:00:00.000Z');
const MIN = 60_000;

function cached(ageMs: number, extra: Partial<CacheRow> = {}): CacheRow {
  return {
    path: PATH,
    etag: '"v1"',
    body: { version: 1 },
    fetchedAt: new Date(NOW.getTime() - ageMs).toISOString(),
    lastError: null,
    lastErrorAt: null,
    ...extra,
  };
}

function storeWith(row?: CacheRow): CacheStore & { rows: Map<string, CacheRow> } {
  const rows = new Map<string, CacheRow>();
  if (row) rows.set(row.path, row);
  return {
    rows,
    getCache: async (path) => rows.get(path) ?? null,
    upsertCache: async (r) => {
      rows.set(r.path, r);
    },
  };
}

function ok(body: unknown, etag = '"v2"'): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { etag } });
}

function deps(store: CacheStore, fetchImpl: typeof fetch) {
  return { store, fetchImpl, now: () => NOW, apiKey: 'test-key' };
}

describe('getTba (§7.3)', () => {
  it('returns the cache without fetching when it is fresh', async () => {
    const fetchImpl = vi.fn();
    const out = await getTba(PATH, { windowMs: MIN }, deps(storeWith(cached(30_000)), fetchImpl));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out).toEqual({ data: { version: 1 }, fetchedAt: cached(30_000).fetchedAt, stale: false });
  });

  it('sends the key, the etag, no-store, and a timeout signal', async () => {
    const fetchImpl = vi.fn(async () => ok({ version: 2 }));
    await getTba(PATH, { windowMs: MIN }, deps(storeWith(cached(2 * MIN)), fetchImpl));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://www.thebluealliance.com/api/v3${PATH}`);
    const headers = new Headers(init.headers);
    expect(headers.get('X-TBA-Auth-Key')).toBe('test-key');
    expect(headers.get('If-None-Match')).toBe('"v1"');
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('200: stores the new body and etag', async () => {
    const store = storeWith(cached(2 * MIN, { lastError: 'old problem', lastErrorAt: new Date(NOW.getTime() - 40_000).toISOString() }));
    const out = await getTba(PATH, { windowMs: MIN }, deps(store, vi.fn(async () => ok({ version: 2 }))));
    expect(out).toEqual({ data: { version: 2 }, fetchedAt: NOW.toISOString(), stale: false });
    expect(store.rows.get(PATH)).toEqual({
      path: PATH, etag: '"v2"', body: { version: 2 },
      fetchedAt: NOW.toISOString(), lastError: null, lastErrorAt: null,
    });
  });

  it('200 with no cache row yet: fetches without If-None-Match', async () => {
    const fetchImpl = vi.fn(async () => ok([1, 2, 3]));
    const store = storeWith();
    const out = await getTba(PATH, { windowMs: MIN }, deps(store, fetchImpl));
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).has('If-None-Match')).toBe(false);
    expect(out.data).toEqual([1, 2, 3]);
    expect(store.rows.get(PATH)?.body).toEqual([1, 2, 3]);
  });

  it('200 with a JSON null body: stores null', async () => {
    const store = storeWith();
    const out = await getTba(PATH, { windowMs: MIN }, deps(store, vi.fn(async () => ok(null))));
    expect(out).toEqual({ data: null, fetchedAt: NOW.toISOString(), stale: false });
    expect(store.rows.get(PATH)?.body).toBeNull();
  });

  it('304: keeps the body, moves fetchedAt forward, clears the error', async () => {
    const store = storeWith(cached(2 * MIN, { lastError: 'old problem', lastErrorAt: new Date(NOW.getTime() - 40_000).toISOString() }));
    const fetchImpl = vi.fn(async () => new Response(null, { status: 304 }));
    const out = await getTba(PATH, { windowMs: MIN }, deps(store, fetchImpl));
    expect(out).toEqual({ data: { version: 1 }, fetchedAt: NOW.toISOString(), stale: false });
    expect(store.rows.get(PATH)).toMatchObject({ etag: '"v1"', fetchedAt: NOW.toISOString(), lastError: null });
  });

  it('404: means "no data", stored as null, not an error', async () => {
    const store = storeWith(cached(2 * MIN));
    const fetchImpl = vi.fn(async () => new Response('{"Error":"nope"}', { status: 404 }));
    const out = await getTba(PATH, { windowMs: MIN }, deps(store, fetchImpl));
    expect(out).toEqual({ data: null, fetchedAt: NOW.toISOString(), stale: false });
    expect(store.rows.get(PATH)).toMatchObject({ body: null, etag: null, lastError: null });
  });

  it('timeout: serves the old data as stale and records the error', async () => {
    const store = storeWith(cached(2 * MIN));
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('The operation timed out', 'TimeoutError');
    });
    const out = await getTba(PATH, { windowMs: MIN }, deps(store, fetchImpl));
    expect(out).toEqual({ data: { version: 1 }, fetchedAt: cached(2 * MIN).fetchedAt, stale: true });
    expect(store.rows.get(PATH)).toMatchObject({
      body: { version: 1 },
      fetchedAt: cached(2 * MIN).fetchedAt,
      lastError: 'TBA timed out',
      lastErrorAt: NOW.toISOString(),
    });
  });

  it.each([500, 503, 401])('HTTP %i: serves the old data as stale', async (status) => {
    const store = storeWith(cached(2 * MIN));
    const out = await getTba(PATH, { windowMs: MIN }, deps(store, vi.fn(async () => new Response('x', { status }))));
    expect(out.stale).toBe(true);
    expect(out.data).toEqual({ version: 1 });
    expect(store.rows.get(PATH)?.lastError).toBe(`TBA returned HTTP ${status}`);
  });

  describe('error back-off', () => {
    it('within 30 s of a recorded failure: serves the cache as stale without calling TBA', async () => {
      const row = cached(2 * MIN, { lastError: 'TBA timed out', lastErrorAt: new Date(NOW.getTime() - 10_000).toISOString() });
      const store = storeWith(row);
      const fetchImpl = vi.fn(async () => ok({ version: 2 }));
      const out = await getTba(PATH, { windowMs: MIN }, deps(store, fetchImpl));
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(out).toEqual({ data: { version: 1 }, fetchedAt: row.fetchedAt, stale: true });
      expect(store.rows.get(PATH)).toEqual(row); // untouched: the back-off does not extend itself
    });

    it('40 s after a recorded failure: tries TBA again', async () => {
      const store = storeWith(
        cached(2 * MIN, { lastError: 'TBA timed out', lastErrorAt: new Date(NOW.getTime() - 40_000).toISOString() }),
      );
      const fetchImpl = vi.fn(async () => ok({ version: 2 }));
      const out = await getTba(PATH, { windowMs: MIN }, deps(store, fetchImpl));
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(out).toMatchObject({ data: { version: 2 }, stale: false });
      expect(store.rows.get(PATH)).toMatchObject({ lastError: null, lastErrorAt: null });
    });
  });

  it('failure with nothing cached: returns null and stale, stores nothing', async () => {
    const store = storeWith();
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const out = await getTba(PATH, { windowMs: MIN }, deps(store, fetchImpl));
    expect(out).toEqual({ data: null, fetchedAt: null, stale: true });
    expect(store.rows.size).toBe(0);
  });

  it('unreadable JSON in a 200 counts as a failure', async () => {
    const store = storeWith(cached(2 * MIN));
    const out = await getTba(PATH, { windowMs: MIN }, deps(store, vi.fn(async () => new Response('<html>', { status: 200 }))));
    expect(out.stale).toBe(true);
    expect(out.data).toEqual({ version: 1 });
  });

  it('a missing API key counts as a failure and does not fetch', async () => {
    const fetchImpl = vi.fn();
    const out = await getTba(PATH, { windowMs: MIN }, { ...deps(storeWith(cached(2 * MIN)), fetchImpl), apiKey: undefined });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out.stale).toBe(true);
  });

  it('force: refetches even inside the cache window', async () => {
    const fetchImpl = vi.fn(async () => ok({ version: 2 }));
    const out = await getTba(PATH, { windowMs: 10 * MIN, force: true }, deps(storeWith(cached(30_000)), fetchImpl));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.data).toEqual({ version: 2 });
  });

  it('force: is ignored when the row is under 15 s old (§8.3)', async () => {
    const fetchImpl = vi.fn();
    const out = await getTba(PATH, { windowMs: 10 * MIN, force: true }, deps(storeWith(cached(14_000)), fetchImpl));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out).toEqual({ data: { version: 1 }, fetchedAt: cached(14_000).fetchedAt, stale: false });
  });

  it('rejects a path that does not start with a slash', async () => {
    await expect(getTba('event/x', { windowMs: MIN }, deps(storeWith(), vi.fn()))).rejects.toThrow();
  });
});
