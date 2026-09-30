'use client';

import { useEffect, useRef } from 'react';

export type PollerDeps = {
  reload: () => Promise<unknown>;
  intervalMs: number;
  /** Read on every tick, so a change takes effect without restarting the timer. */
  isPaused: () => boolean;
  isVisible: () => boolean;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
  addListener: (fn: () => void) => void;
  removeListener: (fn: () => void) => void;
};

/**
 * The timer and tab-visibility logic behind usePolling, with every browser API passed in so it can be
 * tested in Node. Reloads on each tick while the tab is visible and nothing is saving, and right away
 * when the tab becomes visible again. A failed reload is ignored: the next tick tries again.
 * Returns stop(), which clears the timer and the listener.
 */
export function createPoller(deps: PollerDeps): { stop: () => void } {
  const tick = () => {
    if (deps.isVisible() && !deps.isPaused()) deps.reload().catch(() => {});
  };
  const timer = deps.setInterval(tick, deps.intervalMs);
  deps.addListener(tick);
  return {
    stop: () => {
      deps.clearInterval(timer);
      deps.removeListener(tick);
    },
  };
}

/**
 * Re-fetches admin data every `intervalMs` while the tab is visible and `paused` is false, so a second
 * device (or the public page's changes) shows up without a manual reload.
 */
export function usePolling(reload: () => Promise<unknown>, intervalMs: number, opts: { paused: boolean }): void {
  // Refs, so a new `reload` or a paused flip doesn't restart the timer.
  const reloadRef = useRef(reload);
  const pausedRef = useRef(opts.paused);
  useEffect(() => {
    reloadRef.current = reload;
    pausedRef.current = opts.paused;
  });

  useEffect(() => {
    const poller = createPoller({
      reload: () => reloadRef.current(),
      intervalMs,
      isPaused: () => pausedRef.current,
      isVisible: () => document.visibilityState === 'visible',
      setInterval: (fn, ms) => window.setInterval(fn, ms),
      clearInterval: (id) => window.clearInterval(id as number),
      addListener: (fn) => document.addEventListener('visibilitychange', fn),
      removeListener: (fn) => document.removeEventListener('visibilitychange', fn),
    });
    return poller.stop;
  }, [intervalMs]);
}
