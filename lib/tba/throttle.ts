export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Wraps fetch so calls start at most `perSecond` times a second (spec §6.2: ~5 TBA requests/s
 * for the stats build). Calls fired together are queued, each one slot after the last.
 */
export function throttleFetch(fetchImpl: typeof fetch, perSecond: number, clock: Clock = realClock): typeof fetch {
  const gapMs = 1000 / perSecond;
  let nextAt = 0;
  return (async (...args: Parameters<typeof fetch>) => {
    const now = clock.now();
    const at = Math.max(now, nextAt);
    nextAt = at + gapMs;
    if (at > now) await clock.sleep(at - now);
    return fetchImpl(...args);
  }) as typeof fetch;
}
