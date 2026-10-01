// Browser-side draft timing (spec §7.4–§7.6). Pure or dependency-injected, so it's testable in Node.
import { DraftApiError } from '@/lib/draft/api';
import { parseTimestamp, type DraftPhase } from '@/lib/draft/live';

export const DEBOUNCE_MS = 250;
export const MIN_GAP_MS = 1500;
export const TICK_GRACE_MS = 500;
export const TICK_RETRY_MS = 2000;
export const URGENT_MS = 10_000;

export type RefetcherDeps = {
  fetch: () => Promise<unknown>;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  debounceMs?: number;
  minGapMs?: number;
};
export type Refetcher = { ring: () => void; refetchNow: () => void; wake: () => void; stop: () => void };

/**
 * Turns doorbell rings (and polls) into state fetches: debounced 250 ms, at most one per 1.5 s, and a ring
 * during an in-flight fetch schedules exactly one follow-up. wake() (the tab is visible again) skips the
 * debounce but keeps the 1.5 s gap; refetchNow() (after this phone's own action) skips both. Anyone can ring a public channel, so this
 * cap is what keeps a prankster from making every phone hammer the server (§7.5).
 */
export function createRefetcher(deps: RefetcherDeps): Refetcher {
  const debounce = deps.debounceMs ?? DEBOUNCE_MS;
  const minGap = deps.minGapMs ?? MIN_GAP_MS;
  let timer: unknown = null;
  let inFlight = false;
  let followUp = false;
  let lastStart = Number.NEGATIVE_INFINITY;
  let stopped = false;

  async function fire() {
    timer = null;
    inFlight = true;
    lastStart = deps.now();
    try {
      await deps.fetch();
    } catch {
      // The next ring or poll tries again.
    } finally {
      inFlight = false;
    }
    if (followUp && !stopped) {
      followUp = false;
      ring();
    }
  }

  function ring() {
    if (stopped) return;
    if (inFlight) {
      followUp = true;
      return;
    }
    if (timer !== null) return;
    const wait = Math.max(debounce, lastStart + minGap - deps.now());
    timer = deps.setTimeout(() => void fire(), wait);
  }

  function wake() {
    if (stopped) return;
    if (inFlight) {
      followUp = true;
      return;
    }
    if (timer !== null) deps.clearTimeout(timer);
    timer = deps.setTimeout(() => void fire(), Math.max(0, lastStart + minGap - deps.now()));
  }

  function refetchNow() {
    if (stopped) return;
    if (inFlight) {
      followUp = true;
      return;
    }
    if (timer !== null) deps.clearTimeout(timer);
    timer = deps.setTimeout(() => void fire(), 0);
  }

  return {
    ring,
    refetchNow,
    wake,
    stop() {
      stopped = true;
      if (timer !== null) deps.clearTimeout(timer);
      timer = null;
    },
  };
}

export type PoolLoader = { ensure: () => Promise<void> };

/**
 * Loads the team pool until it succeeds once (review I3). A failed fetch (a cold start, a 503 while the
 * database wakes, a flaky phone network) leaves it unloaded, so the next ensure() — every state load —
 * tries again instead of leaving the phone with an empty pool all night.
 */
export function createPoolLoader<T>(deps: { fetch: () => Promise<T>; onLoaded: (pool: T) => void }): PoolLoader {
  let loaded = false;
  let inFlight = false;
  return {
    async ensure() {
      if (loaded || inFlight) return;
      inFlight = true;
      try {
        const pool = await deps.fetch();
        loaded = true;
        deps.onLoaded(pool);
      } catch {
        // Still unloaded: the next ensure() retries.
      } finally {
        inFlight = false;
      }
    },
  };
}

/**
 * What a failed state load means on screen (review M4). A network error or a 5xx is a connection problem:
 * show "Reconnecting…" and keep retrying. A 4xx (private league, deleted round) is a real answer.
 * `message` is shown only before the first state arrives (null = keep the loading screen).
 */
export function loadFailure(err: unknown): { message: string | null; reconnecting: boolean } {
  if (!(err instanceof DraftApiError)) return { message: null, reconnecting: true };
  return { message: err.message, reconnecting: err.status >= 500 };
}

export function pollIntervalMs(subscribed: boolean): number {
  return subscribed ? 15_000 : 3_000;
}

export type TickInput = {
  phase: DraftPhase;
  deadline: string | null;
  isMember: boolean;
  offsetMs: number;
  localNowMs: number;
  lastTickAtMs: number | null;
};

/** §7.4: members' phones ask the server to auto-pick once deadline + 500 ms passes, retrying every 2 s. */
export function shouldTick(i: TickInput): boolean {
  if (!i.isMember || i.phase !== 'live' || !i.deadline) return false;
  if (i.localNowMs + i.offsetMs < parseTimestamp(i.deadline) + TICK_GRACE_MS) return false;
  return i.lastTickAtMs === null || i.localNowMs - i.lastTickAtMs >= TICK_RETRY_MS;
}

/** "0:42". Rounds up, so the clock shows 0:01 until time is really up. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** §7.6: the tab title alternates with "Your pick!" once a second while it's your turn. */
export function titleFrame(base: string, flashing: boolean, frame: number): string {
  return flashing && frame % 2 === 0 ? 'Your pick!' : base;
}
