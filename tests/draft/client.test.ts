import { describe, expect, it, vi } from 'vitest';
import { DraftApiError } from '@/lib/draft/api';
import { createPoolLoader, createRefetcher, formatClock, loadFailure, pollIntervalMs, shouldTick, titleFrame } from '@/lib/draft/client';

/** Manual timers + clock, so the test decides when time passes. */
function fakeTime() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id: unknown) => void timers.delete(id as number),
    /** Lets settled promises run (fetch finishing, follow-up rings), then fires due timers in order. */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        for (let i = 0; i < 5; i++) await Promise.resolve();
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
  };
}

describe('createRefetcher (§7.5)', () => {
  it('debounces a burst of rings into one fetch after 250 ms', async () => {
    const t = fakeTime();
    const fetch = vi.fn(async () => {});
    const r = createRefetcher({ fetch, ...t });
    for (let i = 0; i < 5; i++) r.ring();
    await t.advance(249);
    expect(fetch).not.toHaveBeenCalled();
    await t.advance(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never fetches more than once per 1.5 s, however fast the rings come (doorbell spam)', async () => {
    const t = fakeTime();
    const fetch = vi.fn(async () => {});
    const r = createRefetcher({ fetch, ...t });
    for (let ms = 0; ms < 6000; ms += 50) {
      r.ring();
      await t.advance(50);
    }
    // 6 s of spam: first fetch at 250 ms, then every 1.5 s → at most 4 fetches.
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(4);
    expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('a ring while a fetch is in flight schedules exactly one follow-up', async () => {
    const t = fakeTime();
    let release: () => void = () => {};
    const fetch = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const r = createRefetcher({ fetch, ...t });
    r.ring();
    await t.advance(250);
    expect(fetch).toHaveBeenCalledTimes(1);
    r.ring();
    r.ring();
    release();
    await t.advance(1500);
    expect(fetch).toHaveBeenCalledTimes(2);
    release();
    await t.advance(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refetchNow skips the debounce; stop cancels a pending fetch', async () => {
    const t = fakeTime();
    const fetch = vi.fn(async () => {});
    const r = createRefetcher({ fetch, ...t });
    r.refetchNow();
    await t.advance(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    r.ring();
    r.stop();
    await t.advance(5000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('createRefetcher.wake: the tab is visible again (review M3, §7.5 "immediately")', () => {
  it('fetches right away, skipping the 250 ms debounce', async () => {
    const t = fakeTime();
    const fetch = vi.fn(async () => {});
    const r = createRefetcher({ fetch, ...t });
    r.wake();
    await t.advance(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('cuts short a debounced ring that is already waiting', async () => {
    const t = fakeTime();
    const fetch = vi.fn(async () => {});
    const r = createRefetcher({ fetch, ...t });
    r.ring(); // e.g. the poller's own visibility listener ran first
    r.wake();
    await t.advance(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    await t.advance(5000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('still keeps the 1.5 s gap between fetches', async () => {
    const t = fakeTime();
    const fetch = vi.fn(async () => {});
    const r = createRefetcher({ fetch, ...t });
    r.wake();
    await t.advance(500);
    expect(fetch).toHaveBeenCalledTimes(1);
    r.wake();
    await t.advance(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await t.advance(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('during an in-flight fetch, schedules one follow-up', async () => {
    const t = fakeTime();
    let release: () => void = () => {};
    const fetch = vi.fn(() => new Promise<void>((res) => (release = res)));
    const r = createRefetcher({ fetch, ...t });
    r.wake();
    await t.advance(0);
    r.wake();
    r.wake();
    release();
    await t.advance(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('createPoolLoader (review I3)', () => {
  it('loads once; later calls do nothing', async () => {
    const pool = [{ teamKey: 'frc1' }];
    const fetch = vi.fn(async () => pool);
    const onLoaded = vi.fn();
    const loader = createPoolLoader({ fetch, onLoaded });
    await loader.ensure();
    await loader.ensure();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledWith(pool);
  });

  it('a failed fetch leaves the pool unloaded, and the next call tries again', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce([{ teamKey: 'frc1' }]);
    const onLoaded = vi.fn();
    const loader = createPoolLoader({ fetch, onLoaded });
    await loader.ensure();
    expect(onLoaded).not.toHaveBeenCalled();
    await loader.ensure();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onLoaded).toHaveBeenCalledWith([{ teamKey: 'frc1' }]);
  });

  it('never runs two fetches at once', async () => {
    let release: (v: unknown[]) => void = () => {};
    const fetch = vi.fn(() => new Promise<unknown[]>((res) => (release = res)));
    const loader = createPoolLoader({ fetch, onLoaded: () => {} });
    const first = loader.ensure();
    void loader.ensure();
    release([]);
    await first;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('loadFailure: what a failed state load shows (review M4)', () => {
  it('a 5xx or a network error mid-draft shows "Reconnecting…"', () => {
    expect(loadFailure(new DraftApiError(500, 'Something went wrong'))).toEqual({ message: 'Something went wrong', reconnecting: true });
    expect(loadFailure(new DraftApiError(503, 'The league database is asleep'))).toEqual({
      message: 'The league database is asleep', reconnecting: true,
    });
    expect(loadFailure(new TypeError('Failed to fetch'))).toEqual({ message: null, reconnecting: true });
  });
  it('a 4xx is a real answer (private league, deleted round), not a connection problem', () => {
    expect(loadFailure(new DraftApiError(403, 'This league is private'))).toEqual({ message: 'This league is private', reconnecting: false });
  });
});

describe('timing helpers', () => {
  it('polls every 3 s without Realtime and every 15 s with it', () => {
    expect(pollIntervalMs(false)).toBe(3000);
    expect(pollIntervalMs(true)).toBe(15000);
  });

  it('ticks only for members, after deadline + 500 ms, and at most every 2 s', () => {
    const deadline = new Date(100_000).toISOString();
    const base = { phase: 'live' as const, deadline, isMember: true, offsetMs: 0, lastTickAtMs: null };
    expect(shouldTick({ ...base, localNowMs: 100_499 })).toBe(false);
    expect(shouldTick({ ...base, localNowMs: 100_500 })).toBe(true);
    expect(shouldTick({ ...base, localNowMs: 101_000, lastTickAtMs: 100_500 })).toBe(false);
    expect(shouldTick({ ...base, localNowMs: 102_500, lastTickAtMs: 100_500 })).toBe(true);
    expect(shouldTick({ ...base, localNowMs: 200_000, isMember: false })).toBe(false);
    expect(shouldTick({ ...base, localNowMs: 200_000, phase: 'paused' })).toBe(false);
    expect(shouldTick({ ...base, localNowMs: 200_000, deadline: null })).toBe(false);
    // Phone clock 60 s slow: the server offset makes it tick on time anyway.
    expect(shouldTick({ ...base, localNowMs: 40_500, offsetMs: 60_000 })).toBe(true);
  });

  it('ticks on time for a Postgres deadline with microseconds and +00:00 (review M14)', () => {
    const deadline = '2026-10-23T23:15:42.123456+00:00';
    const at = Date.UTC(2026, 9, 23, 23, 15, 42, 123);
    const base = { phase: 'live' as const, deadline, isMember: true, offsetMs: 0, lastTickAtMs: null };
    expect(shouldTick({ ...base, localNowMs: at + 499 })).toBe(false);
    expect(shouldTick({ ...base, localNowMs: at + 500 })).toBe(true);
  });

  it('formats the clock and flashes the title', () => {
    expect(formatClock(42_000)).toBe('0:42');
    expect(formatClock(41_001)).toBe('0:42');
    expect(formatClock(120_000)).toBe('2:00');
    expect(formatClock(0)).toBe('0:00');
    expect(titleFrame('Ramp Riot draft', true, 0)).toBe('Your pick!');
    expect(titleFrame('Ramp Riot draft', true, 1)).toBe('Ramp Riot draft');
    expect(titleFrame('Ramp Riot draft', false, 0)).toBe('Ramp Riot draft');
  });
});
