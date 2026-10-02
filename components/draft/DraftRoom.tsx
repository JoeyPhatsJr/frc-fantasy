'use client';

import { useState } from 'react';
import { ConfirmSheet } from '@/components/draft/ConfirmSheet';
import { DraftRoomBanner } from '@/components/draft/DraftRoomBanner';
import { PoolList } from '@/components/draft/PoolList';
import { QueueList } from '@/components/draft/QueueList';
import { useDraftRoom } from '@/components/draft/useDraftRoom';
import { DraftBoard } from '@/components/DraftBoard';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { InfoTip } from '@/components/ui/InfoTip';
import { PageTabs } from '@/components/ui/PageTabs';
import { DraftApiError, type DraftApi } from '@/lib/draft/api';
import type { DraftState } from '@/lib/draft/state';
import { GLOSSARY } from '@/lib/glossary';
import type { PoolEntry } from '@/lib/pool/entries';
import { teamLabel } from '@/lib/teams';

type Tab = 'pool' | 'queue' | 'board';
/** Same cap as the PUT draft/queue route. */
export const MAX_QUEUE = 100;

/** UX §6.6: Pool · My queue ({n}) · Board for members; watchers have no queue. The Board shows every roster. */
export function draftTabs(isMember: boolean, queueCount: number): { key: Tab; label: string }[] {
  return [
    { key: 'pool', label: 'Pool' },
    ...(isMember ? [{ key: 'queue' as const, label: queueCount > 0 ? `My queue (${queueCount})` : 'My queue' }] : []),
    { key: 'board', label: 'Board' },
  ];
}

/** The tab the room opens on: the Board once the draft is over, else the Pool. */
export function defaultDraftTab(phase: DraftState['phase']): 'pool' | 'board' {
  return phase === 'done' ? 'board' : 'pool';
}

/** My 1-based place in the draft order, or null when I'm not in it (watchers, or no order yet). */
function positionOf(state: DraftState, playerId: string | null): number | null {
  const i = playerId === null ? -1 : state.order.findIndex((o) => o.playerId === playerId);
  return i < 0 ? null : i + 1;
}

/** §7.6: what to tell the player after a failed action. null = say nothing; 409 stale/not_your_turn just refetch. */
export function actionNotice(err: unknown, pickedTeam?: string): string | null {
  if (!(err instanceof DraftApiError)) return "Couldn't reach the server. Check your connection and try again.";
  if (err.code === 'taken' && pickedTeam) return `${teamLabel(pickedTeam)} was just taken — pick again`;
  if (err.code === 'stale' || err.code === 'not_your_turn') return null;
  return err.message;
}

/** The queue after tapping a team's queue button, or null when adding it would pass MAX_QUEUE. */
export function toggledQueue(queue: string[], teamKey: string): string[] | null {
  if (queue.includes(teamKey)) return queue.filter((k) => k !== teamKey);
  return queue.length >= MAX_QUEUE ? null : [...queue, teamKey];
}

/** The pick a confirm sheet is for. Frozen when the sheet opens, so a clock that moves on can't retarget it. */
export type PickTarget = { entry: PoolEntry; pickNumber: number; forName: string | null };

/**
 * Review I2: the target for drafting `entry` right now. My own turn → my pick; a commissioner with someone
 * else on the clock → "Pick for" them (§7.3); otherwise null.
 */
export function confirmTarget(state: DraftState, entry: PoolEntry): PickTarget | null {
  const me = state.me;
  if (!me || state.phase !== 'live' || !state.onClock) return null;
  if (state.onClock.playerId === me.playerId) return { entry, pickNumber: state.pickNumber, forName: null };
  if (me.isCommissioner) return { entry, pickNumber: state.pickNumber, forName: state.onClock.name };
  return null;
}

/** Sends the frozen pick. If the clock moved since the sheet opened, the server answers 409 stale. */
export function submitPick(api: Pick<DraftApi, 'pick' | 'pickFor'>, target: PickTarget): Promise<unknown> {
  const { pickNumber, entry } = target;
  return target.forName !== null ? api.pickFor(pickNumber, entry.teamKey) : api.pick(pickNumber, entry.teamKey);
}

/** A tapped auto-draft value not yet confirmed by fresh state. `savedAt` is when the save succeeded. */
export type PendingToggle = { value: boolean; savedAt: number | null };

/**
 * Review I4: the auto-draft checkbox shows the tapped value at once and keeps it until a state fetched
 * after the save arrives (`stateSentAt` = when that state's request was sent); from then on the server wins.
 */
export function autodraftShown(server: boolean, pending: PendingToggle | null, stateSentAt: number): boolean {
  if (!pending) return server;
  if (pending.savedAt !== null && stateSentAt >= pending.savedAt) return server;
  return pending.value;
}

export function DraftRoom({ slug, roundId, eventName }: { slug: string; roundId: string; eventName: string }) {
  const room = useDraftRoom(slug, roundId, `${eventName} draft`);
  const { api, state, pool } = room;
  // Null until the first state arrives; then the phase picks the opening tab once and the player drives it.
  const [tab, setTab] = useState<Tab | null>(null);
  const [confirming, setConfirming] = useState<PickTarget | null>(null);
  const [autodraftPending, setAutodraftPending] = useState<PendingToggle | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Adjusting state while rendering (React's documented pattern): runs once, the first render that has state.
  if (state && tab === null) setTab(defaultDraftTab(state.phase));

  if (room.loadError && !state) return <Alert tone="danger">{room.loadError}</Alert>;
  if (!state || !pool) return <p className="text-[15px] text-fg-muted">Loading the draft…</p>;

  const me = state.me ?? null;
  const taken = new Set(state.picks.map((p) => p.teamKey));
  const teamNames = Object.fromEntries(pool.flatMap((e) => (e.nickname ? [[e.teamKey, e.nickname]] : [])));
  const playerNames = Object.fromEntries(state.order.map((o) => [o.playerId, o.name]));
  const myTurn = Boolean(me) && state.phase === 'live' && state.onClock?.playerId === me?.playerId;
  // A commissioner can pick for whoever is on the clock (§7.3 "Pick for Mom").
  const pickingFor = !myTurn && me?.isCommissioner && state.phase === 'live' ? state.onClock : null;
  const lastPick = state.picks[state.picks.length - 1] ?? null;

  /** Runs one action; on any outcome, refetch. 409 stale/not_your_turn refetch silently (§7.6). */
  async function run(action: () => Promise<unknown>, pickedTeam?: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setNotice(actionNotice(err, pickedTeam));
    } finally {
      setBusy(false);
      setConfirming(null);
      room.refetchNow();
    }
  }

  function confirmPick() {
    if (!confirming) return;
    const target = confirming;
    void run(() => submitPick(api, target), target.entry.teamKey);
  }

  /** Optimistic: the box flips at once, reverts on error, and follows the server once fresh state arrives. */
  function toggleAutodraft(on: boolean) {
    setAutodraftPending({ value: on, savedAt: null });
    void run(async () => {
      try {
        await api.setAutodraft(on);
      } catch (err) {
        setAutodraftPending(null);
        throw err;
      }
      setAutodraftPending({ value: on, savedAt: Date.now() });
    });
  }

  function toggleQueue(teamKey: string) {
    if (!me) return;
    const next = toggledQueue(me.queue, teamKey);
    if (!next) {
      setNotice(`A queue can hold at most ${MAX_QUEUE} teams`);
      return;
    }
    void run(() => api.setQueue(next));
  }

  const activeTab: Tab = tab ?? defaultDraftTab(state.phase);
  const tabs = draftTabs(me !== null, me ? me.queue.filter((k) => !taken.has(k)).length : 0);
  const autodraftOn = me ? autodraftShown(me.autodraft, autodraftPending, room.stateSentAt) : false;

  return (
    <div className="space-y-4">
      {/* The banner with the controls right under it: auto-draft for members, then the commissioner strip. */}
      <div>
        <DraftRoomBanner
          state={state}
          remainingMs={room.remaining}
          meId={me?.playerId ?? null}
          reconnecting={room.reconnecting}
          myPosition={positionOf(state, me?.playerId ?? null)}
          playerCount={state.order.length}
        />

        {me ? (
          <div className="-mx-4 flex items-start justify-between gap-3 border-b border-border px-4 py-1">
            <span className="flex min-h-11 items-center text-[15px] font-semibold text-fg">
              {GLOSSARY.autodraft.label}
              <InfoTip term="autodraft" />
            </span>
            {/* Same handler and disabled rule as the old checkbox: a tap sends the opposite of what is shown. */}
            <button
              type="button"
              role="switch"
              aria-checked={autodraftOn}
              aria-label={GLOSSARY.autodraft.label}
              disabled={busy || state.phase === 'done'}
              onClick={() => toggleAutodraft(!autodraftOn)}
              className="flex min-h-11 shrink-0 cursor-pointer touch-manipulation items-center gap-2 rounded-lg px-1 text-[13px] font-semibold text-fg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true">{autodraftOn ? 'On' : 'Off'}</span>
              <span
                aria-hidden="true"
                className={`relative inline-flex h-7 w-12 items-center rounded-full motion-safe:transition-colors ${
                  autodraftOn ? 'bg-primary-fill' : 'bg-border'
                }`}
              >
                <span
                  className={`absolute size-5 rounded-full bg-on-primary shadow motion-safe:transition-transform ${
                    autodraftOn ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </span>
            </button>
          </div>
        ) : (
          <p className="py-2 text-[15px] text-fg-muted">You&apos;re watching — only league members can draft.</p>
        )}

        {me?.isCommissioner ? (
          <div
            role="group"
            aria-label="Commissioner controls"
            className="-mx-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5"
          >
            <span className="text-[13px] font-semibold text-secondary">Commissioner</span>
            {state.phase === 'live' ? (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => api.control('pause'))}>
                Pause
              </Button>
            ) : null}
            {state.phase === 'paused' ? (
              <Button size="sm" disabled={busy} onClick={() => void run(() => api.control('resume'))}>
                Resume
              </Button>
            ) : null}
            {lastPick && state.phase !== 'setup' ? (
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => {
                  const label = `${teamLabel(lastPick.teamKey)} (${playerNames[lastPick.playerId] ?? 'Unknown'})`;
                  if (window.confirm(`Undo the last pick: ${label}?`)) void run(() => api.undo(lastPick.pickNumber));
                }}
              >
                Undo last pick
              </Button>
            ) : null}
            {state.phase === 'setup' ? (
              // Starting stays in round admin (LiveDraftControls); this only points there.
              <Button href={`/l/${encodeURIComponent(slug)}/admin/r/${encodeURIComponent(roundId)}`} variant="secondary" size="sm">
                Start it in Admin
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {notice ? (
        <Alert tone="warning" className="flex items-start justify-between gap-2">
          {notice}
        </Alert>
      ) : null}

      <PageTabs label="Draft room" items={tabs} active={activeTab} onSelect={(key) => setTab(key as Tab)} />

      <div role="tabpanel">
        {activeTab === 'pool' ? (
          <PoolList
            slug={slug}
            roundId={roundId}
            entries={pool}
            taken={taken}
            queued={new Set(me?.queue ?? [])}
            canDraft={!busy && (myTurn || Boolean(pickingFor))}
            draftLabel={pickingFor ? `Pick for ${pickingFor.name}` : 'Draft'}
            readOnly={!me}
            queueDisabled={busy}
            onDraft={(entry) => setConfirming(confirmTarget(state, entry))}
            onToggleQueue={toggleQueue}
          />
        ) : null}
        {activeTab === 'queue' && me ? (
          <QueueList
            queue={me.queue}
            teamNames={teamNames}
            taken={taken}
            disabled={busy}
            onChange={(next) => void run(() => api.setQueue(next))}
          />
        ) : null}
        {activeTab === 'board' ? (
          <DraftBoard
            picks={state.picks}
            draftOrder={state.order.map((o) => o.playerId)}
            rosterSize={state.rosterSize}
            playerNames={playerNames}
            teamNames={teamNames}
            highlightPick={lastPick?.pickNumber}
          />
        ) : null}
      </div>

      {confirming ? (
        <ConfirmSheet
          entry={confirming.entry}
          forName={confirming.forName}
          busy={busy}
          onConfirm={confirmPick}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </div>
  );
}
