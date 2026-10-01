import { beforeEach, describe, expect, it } from 'vitest';
import type { Repo } from '@/lib/db/repo';
import type { CacheRow } from '@/lib/db/types';
import { bodyHash } from '@/lib/scores/hash';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
const row = (path: string, body: unknown, extra: Partial<CacheRow> = {}): CacheRow => ({
  path,
  etag: '"e"',
  body,
  fetchedAt: '2026-10-24T12:00:00.000Z',
  lastError: null,
  lastErrorAt: null,
  ...extra,
});

beforeEach(() => {
  repo = createMemoryRepo();
});

describe('getCacheMeta', () => {
  it('returns metadata for the paths that exist, with body_hash computed on write', async () => {
    await repo.upsertCache(row('/event/x/teams/simple', [{ key: 'frc1' }]));
    await repo.upsertCache(row('/event/x/awards', null, { lastErrorAt: '2026-10-24T12:01:00.000Z' }));

    const meta = await repo.getCacheMeta(['/event/x/teams/simple', '/event/x/awards', '/event/x/oprs']);
    const byPath = new Map(meta.map((m) => [m.path, m]));

    expect(meta).toHaveLength(2);
    expect(byPath.get('/event/x/teams/simple')).toEqual({
      path: '/event/x/teams/simple',
      fetchedAt: '2026-10-24T12:00:00.000Z',
      bodyHash: bodyHash([{ key: 'frc1' }]),
      lastErrorAt: null,
    });
    expect(byPath.get('/event/x/awards')?.bodyHash).toBeNull();
    expect(byPath.get('/event/x/awards')?.lastErrorAt).toBe('2026-10-24T12:01:00.000Z');
  });

  it('keeps the hash when the same body is re-saved (a 304 or a failed refresh)', async () => {
    await repo.upsertCache(row('/p', { b: 1, a: 2 }));
    const before = (await repo.getCacheMeta(['/p']))[0].bodyHash;
    await repo.upsertCache(row('/p', { a: 2, b: 1 }, { fetchedAt: '2026-10-24T13:00:00.000Z' }));
    expect((await repo.getCacheMeta(['/p']))[0].bodyHash).toBe(before);
  });

  it('returns nothing for an empty path list', async () => {
    expect(await repo.getCacheMeta([])).toEqual([]);
  });
});
