import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ scoreCalls: 0, throwOnce: false }));
vi.mock('@/lib/db', () => ({
  getRepo: () => {
    throw new Error('tests pass the repo explicitly');
  },
}));
vi.mock('@/lib/scoring/engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/scoring/engine')>();
  return {
    ...real,
    scoreEvent: (...args: Parameters<typeof real.scoreEvent>) => {
      h.scoreCalls += 1;
      if (h.throwOnce) {
        h.throwOnce = false;
        throw new Error('boom');
      }
      return real.scoreEvent(...args);
    },
  };
});

import type { Repo } from '@/lib/db/repo';
import { defaultScoring, type ScoringConfig } from '@/lib/scoring/config';
import { configHash } from '@/lib/scores/hash';
import { getEventScores } from '@/lib/scores/eventScores';
import { cleanEventData } from '@/lib/tba/clean';
import { eventPaths } from '@/lib/tba/event';
import type { EventData } from '@/lib/tba/types';
import { emptyEvent, match, rankRow, rankings } from '../helpers/builders';
import { createMemoryRepo } from '../helpers/memoryRepo';

const { scoreEvent: realScore } = await vi.importActual<typeof import('@/lib/scoring/engine')>(
  '@/lib/scoring/engine',
);

const EVENT = '2099test';
const WINDOW = 60_000;
const RED = ['frc1', 'frc2', 'frc3'];
const BLUE = ['frc4', 'frc5', 'frc6'];

function eventData(redScore: number): EventData {
  return {
    ...emptyEvent(),
    teams: [...RED, ...BLUE].map((key) => ({ key, team_number: Number(key.slice(3)), nickname: `Team ${key.slice(3)}` })),
    rankings: rankings([rankRow(1, 'frc1', [1, 0, 0], { extra_stats: [3] }), rankRow(2, 'frc4', [0, 1, 0], { extra_stats: [0] })]),
    matches: [match({ num: 1, red: RED, blue: BLUE, redScore, blueScore: 10 })],
  };
}

/** A fake TBA: serves `data` per endpoint, answers 304 for a matching ETag, can go offline. */
function fakeTba(initial: EventData | null) {
  let data = initial;
  let version = 1;
  let down = false;
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    if (down || data === null) throw new Error('offline');
    const m = /\/event\/[^/]+\/(teams|matches|rankings|alliances|awards|oprs)/.exec(u);
    const etag = `"v${version}"`;
    if (new Headers(init?.headers).get('If-None-Match') === etag) return new Response(null, { status: 304 });
    return new Response(JSON.stringify(data[m![1] as keyof EventData]), { status: 200, headers: { etag } });
  }) as typeof fetch;
  return {
    fetchImpl,
    calls,
    change(next: EventData) {
      data = next;
      version += 1;
    },
    setDown(v: boolean) {
      down = v;
    },
  };
}

let repo: Repo;
let now: Date;
let tba: ReturnType<typeof fakeTba>;
let getCacheCalls: number;

function run(config: ScoringConfig = defaultScoring()) {
  return getEventScores(EVENT, config, WINDOW, {
    now,
    repo,
    tba: { fetchImpl: tba.fetchImpl, apiKey: 'k', now: () => now },
  });
}
const later = (ms: number) => {
  now = new Date(now.getTime() + ms);
};

beforeEach(() => {
  const inner = createMemoryRepo();
  getCacheCalls = 0;
  // Count body reads: getCache returns the full row including the TBA body.
  repo = {
    ...inner,
    getCache: (path) => {
      getCacheCalls += 1;
      return inner.getCache(path);
    },
  };
  now = new Date('2026-10-24T12:00:00.000Z');
  tba = fakeTba(eventData(50));
  h.scoreCalls = 0;
  h.throwOnce = false;
});

describe('getEventScores', () => {
  it('on a first view: fetches TBA, scores, and caches the result', async () => {
    const res = await run();
    expect(tba.calls).toHaveLength(6);
    expect(res.scores).toEqual(realScore(cleanEventData(eventData(50)), defaultScoring()));
    expect(res.info.teamNames.frc1).toBe('Team 1');
    expect(res.stale).toBe(false);
    expect(res.fetchedAt).toBe('2026-10-24T12:00:00.000Z');
    expect(await repo.getEventScoresRow(EVENT, configHash(defaultScoring()))).not.toBeNull();
  });

  it('within the window: returns the cached scores without reading TBA bodies or re-scoring', async () => {
    const first = await run();
    tba.calls.length = 0;
    getCacheCalls = 0;
    h.scoreCalls = 0;
    later(30_000);

    const second = await run();
    expect(tba.calls).toHaveLength(0);
    expect(getCacheCalls).toBe(0);
    expect(h.scoreCalls).toBe(0);
    expect(second.scores).toEqual(first.scores);
    expect(second.info).toEqual(first.info);
    expect(second.fetchedAt).toBe('2026-10-24T12:00:00.000Z');
  });

  it('after the window, a 304 keeps the stamp, so nothing is re-scored', async () => {
    await run();
    const before = await repo.getEventScoresRow(EVENT, configHash(defaultScoring()));
    h.scoreCalls = 0;
    later(2 * WINDOW);

    const res = await run();
    expect(tba.calls).toHaveLength(12); // six more requests, all answered 304
    expect(h.scoreCalls).toBe(0);
    expect(res.fetchedAt).toBe(now.toISOString());
    expect((await repo.getEventScoresRow(EVENT, configHash(defaultScoring())))?.computedAt).toBe(before?.computedAt);
  });

  it('after the window, changed TBA data is re-scored and the row replaced', async () => {
    await run();
    later(2 * WINDOW);
    tba.change(eventData(5)); // blue now wins match 1

    const res = await run();
    expect(res.scores).toEqual(realScore(cleanEventData(eventData(5)), defaultScoring()));
    expect(res.scores).not.toEqual(realScore(cleanEventData(eventData(50)), defaultScoring()));
    const row = await repo.getEventScoresRow(EVENT, configHash(defaultScoring()));
    expect(row?.computedAt).toBe(now.toISOString());
  });

  it('keeps a separate row per scoring config', async () => {
    const custom = defaultScoring();
    custom.qualWin = 100;
    const a = await run();
    const b = await run(custom);
    expect(b.scores.teams.get('frc1')!.total).toBeGreaterThan(a.scores.teams.get('frc1')!.total);
    expect(await repo.getEventScoresRow(EVENT, configHash(custom))).not.toBeNull();
    expect(await repo.getEventScoresRow(EVENT, configHash(defaultScoring()))).not.toBeNull();
  });

  it('with only opts.now given, the TBA refresh uses that same clock', async () => {
    await run();
    // The real clock says "still in the window"; opts.now says "window passed". opts.now must win.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(now.getTime() + 30_000));
      later(2 * WINDOW);
      tba.calls.length = 0;
      const res = await getEventScores(EVENT, defaultScoring(), WINDOW, {
        now,
        repo,
        tba: { fetchImpl: tba.fetchImpl, apiKey: 'k' },
      });
      expect(tba.calls).toHaveLength(6);
      expect(res.fetchedAt).toBe(now.toISOString());
      expect(res.stale).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // Review Focus 2.
  it('when TBA has never answered: empty scores, marked stale, nothing cached, tries again next time', async () => {
    tba = fakeTba(null);
    const res = await run();
    expect(res.scores.teams.size).toBe(0);
    expect(res.stale).toBe(true);
    expect(res.fetchedAt).toBeNull();
    expect(await repo.getEventScoresRow(EVENT, configHash(defaultScoring()))).toBeNull();

    tba.calls.length = 0;
    await run();
    expect(tba.calls).toHaveLength(6);
  });

  // Final review I1: the season scorer's budget-exhausted fallback.
  it('cacheOnly on a cold cache: no TBA fetch, empty scores, stale, nothing cached', async () => {
    const res = await getEventScores(EVENT, defaultScoring(), WINDOW, {
      now, repo, cacheOnly: true, tba: { fetchImpl: tba.fetchImpl, apiKey: 'k', now: () => now },
    });
    expect(tba.calls).toHaveLength(0);
    expect(res.scores.teams.size).toBe(0);
    expect(res.stale).toBe(true);
    expect(res.fetchedAt).toBeNull();
    expect(await repo.getEventScoresRow(EVENT, configHash(defaultScoring()))).toBeNull();
  });

  it('cacheOnly past the window: serves the cached scores without fetching, marked stale', async () => {
    const good = await run();
    later(10 * WINDOW);
    tba.calls.length = 0;
    h.scoreCalls = 0;
    const res = await getEventScores(EVENT, defaultScoring(), WINDOW, {
      now, repo, cacheOnly: true, tba: { fetchImpl: tba.fetchImpl, apiKey: 'k', now: () => now },
    });
    expect(tba.calls).toHaveLength(0);
    expect(h.scoreCalls).toBe(0);
    expect(res.scores).toEqual(good.scores);
    expect(res.stale).toBe(true);
    expect(res.fetchedAt).toBe('2026-10-24T12:00:00.000Z');
  });

  it('when TBA goes down after a good fetch: serves the cached scores, marked stale', async () => {
    const good = await run();
    later(2 * WINDOW);
    tba.setDown(true);
    const res = await run();
    expect(res.stale).toBe(true);
    expect(res.scores).toEqual(good.scores);
  });

  // Plan Deviation 4: with any path never cached there is no stamp, so nothing is cached.
  it('when one input path has never been cached: scores what it has, marked stale, caches nothing', async () => {
    const base = tba.fetchImpl;
    let awardsDown = true;
    tba = {
      ...tba,
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        if (awardsDown && String(url).includes('/awards')) throw new Error('offline');
        return base(url, init);
      }) as typeof fetch,
    };
    const res = await run();
    expect(res.scores.teams.size).toBe(6);
    expect(res.stale).toBe(true);
    expect(await repo.getEventScoresRow(EVENT, configHash(defaultScoring()))).toBeNull();

    awardsDown = false;
    const retry = await run();
    expect(retry.stale).toBe(false);
    expect(await repo.getEventScoresRow(EVENT, configHash(defaultScoring()))).not.toBeNull();
  });

  it('if scoring throws: empty scores, stale, and the failure is not cached', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.throwOnce = true;
    const res = await run();
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
    expect(res.scores.teams.size).toBe(0);
    expect(res.stale).toBe(true);
    expect(await repo.getEventScoresRow(EVENT, configHash(defaultScoring()))).toBeNull();

    const retry = await run();
    expect(retry.scores.teams.size).toBe(6);
  });

  // Final review C1: a concurrent tba_cache write between the body read and the stamp must never
  // produce a (new stamp, old scores) row that later views serve as fresh.
  it('a newer body saved while this request scores never leaves old scores under the new stamp', async () => {
    const inner = createMemoryRepo();
    const v1 = eventData(50);
    const v2 = eventData(5); // blue now wins match 1
    const paths = eventPaths(EVENT);
    for (const name of Object.keys(paths) as (keyof EventData)[]) {
      await inner.upsertCache({
        path: paths[name], etag: '"v1"', body: v1[name], fetchedAt: now.toISOString(), lastError: null, lastErrorAt: null,
      });
    }
    let raced = false;
    repo = {
      ...inner,
      getCache: async (path) => {
        const row = await inner.getCache(path);
        if (!raced && path === paths.matches && row) {
          raced = true; // another request (refresh route, cron, a viewer) saves newer matches right now
          await inner.upsertCache({ ...row, etag: '"v2"', body: v2.matches });
        }
        return row;
      },
    };

    await run(); // scores v1 bodies while matches moves to v2 underneath
    const second = await run();
    expect(second.stale).toBe(false);
    expect(second.scores).toEqual(realScore(cleanEventData(v2), defaultScoring()));

    h.scoreCalls = 0;
    const third = await run(); // now a plain hit on the v2 row
    expect(h.scoreCalls).toBe(0);
    expect(third.scores).toEqual(realScore(cleanEventData(v2), defaultScoring()));
  });

  it('a miss reads tba_cache metadata once (the stamp comes from the scored bodies)', async () => {
    await run();
    later(2 * WINDOW);
    let metaCalls = 0;
    const base = repo;
    repo = { ...base, getCacheMeta: (p) => { metaCalls += 1; return base.getCacheMeta(p); } };
    await run();
    expect(metaCalls).toBe(1);
  });

  it('treats a corrupt cached row as a miss and replaces it', async () => {
    await run();
    const hash = configHash(defaultScoring());
    const row = await repo.getEventScoresRow(EVENT, hash);
    await repo.upsertEventScoresRow({ ...row!, scores: { teams: 'broken' } });
    h.scoreCalls = 0;

    const res = await run();
    expect(h.scoreCalls).toBe(1);
    expect(res.scores.teams.size).toBe(6);
    expect((await repo.getEventScoresRow(EVENT, hash))?.scores).not.toEqual({ teams: 'broken' });
  });
});
