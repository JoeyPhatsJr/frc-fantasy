'use client';

import { useState } from 'react';
import { ConfirmSheet } from '@/components/draft/ConfirmSheet';
import { DraftRoomBanner } from '@/components/draft/DraftRoomBanner';
import { DraftRosters } from '@/components/draft/DraftRosters';
import { PoolList } from '@/components/draft/PoolList';
import { QueueList } from '@/components/draft/QueueList';
import { useDraftRoom } from '@/components/draft/useDraftRoom';
import { DraftBoard } from '@/components/DraftBoard';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { DraftApiError } from '@/lib/draft/api';
import type { PoolEntry } from '@/lib/pool/entries';
import { teamLabel } from '@/lib/teams';

type Tab = 'pool' | 'queue' | 'board' | 'rosters';
/** Same cap as the PUT draft/queue route. */
export const MAX_QUEUE = 100;

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

export function DraftRoom({ slug, roundId, eventName }: { slug: string; roundId: string; eventName: string }) {
  const room = useDraftRoom(slug, roundId, `${eventName} draft`);
  const { api, state, pool } = room;
  const [tab, setTab] = useState<Tab>('pool');
  const [confirming, setConfirming] = useState<PoolEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
    if (!confirming || !state) return;
    const teamKey = confirming.teamKey;
    void run(
      () => (pickingFor ? api.pickFor(state.pickNumber, teamKey) : api.pick(state.pickNumber, teamKey)),
      teamKey,
    );
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

  const tabs: { id: Tab; label: string }[] = [
    { id: 'pool', label: 'Pool' },
    ...(me ? [{ id: 'queue' as const, label: `Queue${me.queue.length ? ` (${me.queue.filter((k) => !taken.has(k)).length})` : ''}` }] : []),
    { id: 'board', label: 'Board' },
    { id: 'rosters', label: 'Rosters' },
  ];

  return (
    <div className="space-y-4">
      <DraftRoomBanner
        state={state}
        remainingMs={room.remaining}
        meId={me?.playerId ?? null}
        reconnecting={room.reconnecting}
      />

      {notice ? (
        <Alert tone="warning" className="flex items-start justify-between gap-2">
          {notice}
        </Alert>
      ) : null}

      {me ? (
        <details className="rounded-xl border border-border bg-surface px-3 py-2">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-fg">Draft options</summary>
          <div className="space-y-3 pt-2 pb-1">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-fg">
              <input
                type="checkbox"
                className="size-5"
                checked={me.autodraft}
                disabled={busy || state.phase === 'done'}
                onChange={(ev) => void run(() => api.setAutodraft(ev.target.checked))}
              />
              Auto-draft for me
            </label>
            {me.isCommissioner ? (
              <div className="flex flex-wrap gap-2">
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
              </div>
            ) : null}
          </div>
        </details>
      ) : (
        <p className="text-[15px] text-fg-muted">You&apos;re watching. Only league members can draft.</p>
      )}

      {/* Watchers have no Queue tab, so three columns (literal classes, so Tailwind keeps both). */}
      <div
        role="tablist"
        aria-label="Draft room"
        className={`grid ${me ? 'grid-cols-4' : 'grid-cols-3'} gap-1 rounded-pill bg-surface-2 p-1`}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-11 cursor-pointer rounded-pill px-2 text-[14px] font-semibold ${
              tab === t.id ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'pool' ? (
          <PoolList
            entries={pool}
            taken={taken}
            queued={new Set(me?.queue ?? [])}
            canDraft={!busy && (myTurn || Boolean(pickingFor))}
            draftLabel={pickingFor ? `Pick for ${pickingFor.name}` : 'Draft'}
            readOnly={!me}
            onDraft={setConfirming}
            onToggleQueue={toggleQueue}
          />
        ) : null}
        {tab === 'queue' && me ? (
          <QueueList
            queue={me.queue}
            teamNames={teamNames}
            taken={taken}
            disabled={busy}
            onChange={(next) => void run(() => api.setQueue(next))}
          />
        ) : null}
        {tab === 'board' ? (
          <DraftBoard
            picks={state.picks}
            draftOrder={state.order.map((o) => o.playerId)}
            rosterSize={state.rosterSize}
            playerNames={playerNames}
            teamNames={teamNames}
            highlightPick={lastPick?.pickNumber}
          />
        ) : null}
        {tab === 'rosters' ? (
          <DraftRosters order={state.order} picks={state.picks} rosterSize={state.rosterSize} teamNames={teamNames} />
        ) : null}
      </div>

      {confirming ? (
        <ConfirmSheet
          entry={confirming}
          forName={pickingFor?.name ?? null}
          busy={busy}
          onConfirm={confirmPick}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </div>
  );
}
