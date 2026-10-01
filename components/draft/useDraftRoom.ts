'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePolling } from '@/components/admin/usePolling';
import { draftApi } from '@/lib/draft/api';
import {
  createPoolLoader,
  createRefetcher,
  loadFailure,
  pollIntervalMs,
  shouldTick,
  titleFrame,
  type PoolLoader,
  type Refetcher,
} from '@/lib/draft/client';
import { clockOffset, remainingMs } from '@/lib/draft/live';
import type { DraftState } from '@/lib/draft/state';
import type { PoolEntry } from '@/lib/pool/entries';
import { DOORBELL_EVENT, draftTopic } from '@/lib/realtime/doorbell';
import { createBrowserSupabase } from '@/lib/supabase/browser';

/**
 * Keeps one phone in sync with the live draft (spec §7.5): Realtime "doorbell" → rate-limited refetch,
 * polling as a fallback, a server-corrected countdown, timeout ticks, and the "Your pick!" title flash.
 */
export function useDraftRoom(slug: string, roundId: string, baseTitle: string) {
  const api = useMemo(() => draftApi(slug, roundId), [slug, roundId]);
  const [state, setState] = useState<DraftState | null>(null);
  /** When the request behind `state` was sent (Date.now()), so the UI can tell fresh state from old. */
  const [stateSentAt, setStateSentAt] = useState(0);
  const [pool, setPool] = useState<PoolEntry[] | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [subscribed, setSubscribed] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // The pool loads with the first state and, if that fails, retries with every later state load (review I3).
  const poolLoader = useMemo<PoolLoader>(() => createPoolLoader({ fetch: api.pool, onLoaded: setPool }), [api]);

  const load = useCallback(async () => {
    void poolLoader.ensure();
    const sentAt = Date.now();
    try {
      const s = await api.state();
      setOffsetMs(clockOffset(s.serverNow, sentAt, Date.now()));
      setState(s);
      setStateSentAt(sentAt);
      setReconnecting(false);
      setLoadError(null);
    } catch (err) {
      const f = loadFailure(err);
      if (f.message !== null) setLoadError(f.message);
      if (f.reconnecting) setReconnecting(true);
    }
  }, [api, poolLoader]);

  const refetcher = useRef<Refetcher | null>(null);
  useEffect(() => {
    const r = createRefetcher({
      fetch: load,
      now: () => Date.now(),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id as number),
    });
    refetcher.current = r;
    r.refetchNow();
    return () => r.stop();
  }, [load]);
  const ring = useCallback(() => refetcher.current?.ring(), []);
  const refetchNow = useCallback(() => refetcher.current?.refetchNow(), []);

  // The doorbell: an empty broadcast on draft:{roundId} means "something changed — refetch".
  useEffect(() => {
    const supabase = createBrowserSupabase();
    const channel = supabase
      .channel(draftTopic(roundId))
      .on('broadcast', { event: DOORBELL_EVENT }, () => ring())
      .subscribe((status) => setSubscribed(status === 'SUBSCRIBED'));
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roundId, ring]);

  // Polling fallback: every 3 s without Realtime, 15 s with it.
  usePolling(async () => ring(), pollIntervalMs(subscribed), { paused: false });
  // Spec §7.5: refetch immediately when the tab is shown again (no debounce; the 1.5 s cap still holds).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetcher.current?.wake();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // The local countdown (4× a second) and timeout ticks (§7.4).
  const live = useRef({ state, offsetMs });
  useEffect(() => {
    live.current = { state, offsetMs };
  });
  const lastTickAt = useRef<number | null>(null);
  useEffect(() => {
    lastTickAt.current = null; // a new pick gets fresh tick timing
  }, [state?.pickNumber]);
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      const s = live.current.state;
      if (
        s &&
        shouldTick({
          phase: s.phase,
          deadline: s.deadline,
          isMember: Boolean(s.me),
          offsetMs: live.current.offsetMs,
          localNowMs: now,
          lastTickAtMs: lastTickAt.current,
        })
      ) {
        lastTickAt.current = now;
        api.tick(s.pickNumber).then(
          (r) => {
            if (r.picked) refetchNow();
          },
          () => {},
        );
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [api, refetchNow]);

  // Your turn: flash the tab title and buzz once (Android; iOS ignores vibrate).
  const myTurn = Boolean(state?.me) && state?.phase === 'live' && state?.onClock?.playerId === state?.me?.playerId;
  useEffect(() => {
    if (!myTurn) return;
    try {
      navigator.vibrate?.(200);
    } catch {
      // Some browsers throw instead of ignoring it.
    }
    let frame = 0;
    document.title = titleFrame(baseTitle, true, frame++);
    const id = window.setInterval(() => {
      document.title = titleFrame(baseTitle, true, frame++);
    }, 1000);
    return () => {
      window.clearInterval(id);
      document.title = baseTitle;
    };
  }, [myTurn, baseTitle]);

  const remaining = remainingMs(state?.deadline ?? null, offsetMs, nowMs);
  return { api, state, stateSentAt, pool, remaining, reconnecting, loadError, subscribed, refetchNow };
}
