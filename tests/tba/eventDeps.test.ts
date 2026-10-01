import { describe, expect, it } from 'vitest';
import type { CacheRow } from '@/lib/db/types';
import type { CacheStore } from '@/lib/tba/client';
import { loadEventData } from '@/lib/tba/event';

describe('loadEventData deps', () => {
  it('passes store, fetch, clock, and key through to getTba', async () => {
    const rows = new Map<string, CacheRow>();
    const store: CacheStore = {
      getCache: async (p) => rows.get(p) ?? null,
      upsertCache: async (r) => {
        rows.set(r.path, r);
      },
    };
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response('[]', { status: 200, headers: { etag: '"a"' } });
    }) as typeof fetch;

    const loaded = await loadEventData(
      '2099test',
      { windowMs: 60_000 },
      { store, fetchImpl, apiKey: 'k', now: () => new Date('2026-10-24T12:00:00.000Z') },
    );

    expect(urls).toHaveLength(6);
    expect(rows.size).toBe(6);
    expect(loaded.fetchedAt).toBe('2026-10-24T12:00:00.000Z');
    expect(loaded.stale).toBe(false);
  });
});
