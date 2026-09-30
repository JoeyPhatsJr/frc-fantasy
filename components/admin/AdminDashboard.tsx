'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AddForm, AddRoundForm, PlayerRow, RenameLeague } from '@/components/admin/DashboardParts';
import { AdminGate } from '@/components/admin/AdminGate';
import { ScoringForm } from '@/components/admin/ScoringForm';
import { usePolling } from '@/components/admin/usePolling';
import { CopyButton } from '@/components/CopyButton';
import { StatusBadge } from '@/components/StatusBadge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChevronDown, Trash2 } from '@/components/ui/icons';
import type { AdminApi } from '@/lib/admin/client';
import type { AdminState, EventLookup } from '@/lib/api/types';
import { formatDateRange } from '@/lib/format';

export function AdminDashboard({ slug }: { slug: string }) {
  return <AdminGate slug={slug}>{(api) => <Dashboard slug={slug} api={api} />}</AdminGate>;
}

function Dashboard({ slug, api }: { slug: string; api: AdminApi }) {
  const [state, setState] = useState<AdminState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Which action is running (it shows the spinner); every other control is disabled meanwhile. */
  const [pending, setPending] = useState<string | null>(null);
  const busy = pending !== null;

  /** Counts reloads, so a slow background poll can't overwrite the fresher state a change just loaded. */
  const latestReload = useRef(0);
  const reload = useCallback(async () => {
    const n = ++latestReload.current;
    const next = await api<AdminState>('/state');
    if (n === latestReload.current) setState(next);
  }, [api]);

  useEffect(() => {
    reload().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Something went wrong'));
  }, [reload]);

  // Picks up changes from another device. Paused while a change runs; `run` reloads when it finishes.
  usePolling(reload, 30_000, { paused: busy });

  /**
   * Runs one change, then reloads so the screen always shows what the server has.
   * Resolves to true when the change worked (so a form knows to clear its box).
   */
  const run = useCallback(
    async (key: string, action: () => Promise<unknown>, done?: string): Promise<boolean> => {
      setPending(key);
      setError(null);
      setNotice(null);
      let ok = false;
      try {
        await action();
        ok = true;
        if (done) setNotice(done);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        await reload().catch(() => {});
        setPending(null);
      }
      return ok;
    },
    [reload],
  );

  /** Looks an event up on TBA without adding it. A look-up changes nothing, so there is no reload. */
  const lookUpEvent = useCallback(
    async (eventKey: string): Promise<EventLookup | null> => {
      setPending('check-round');
      setError(null);
      setNotice(null);
      try {
        return await api<EventLookup>(`/events/${encodeURIComponent(eventKey.trim())}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
        return null;
      } finally {
        setPending(null);
      }
    },
    [api],
  );

  if (!state) {
    return (
      <main id="main">
        {error ? (
          <Alert tone="danger">{error}</Alert>
        ) : (
          <p role="status" className="flex min-h-11 items-center text-fg-muted">
            Loading…
          </p>
        )}
      </main>
    );
  }

  const publicLink = typeof window === 'undefined' ? '' : `${window.location.origin}/l/${slug}`;

  return (
    <main id="main" className="space-y-6">
      <header className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-wider text-secondary">Commissioner</p>
        <h1 className="break-words font-display text-4xl font-bold uppercase leading-tight tracking-wide text-fg">
          {state.league.name}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button href={`/l/${slug}`} variant="secondary">
            View public page
          </Button>
          <CopyButton text={publicLink} label="Copy public link" />
        </div>
      </header>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <RenameLeague
        key={state.league.name}
        name={state.league.name}
        busy={busy}
        saving={pending === 'league'}
        onSave={(name) => run('league', () => api('/league', { method: 'PATCH', body: { name } }), 'League renamed.')}
      />

      <section>
        <Card title="Players" className="space-y-3">
          {state.players.length === 0 ? <p className="text-sm text-fg-muted">No players yet.</p> : null}
          <ul className="space-y-2">
            {state.players.map((player) => (
              <PlayerRow
                key={`${player.id}:${player.name}`}
                player={player}
                busy={busy}
                pending={
                  pending === `rename:${player.id}` ? 'rename' : pending === `remove:${player.id}` ? 'remove' : null
                }
                onRename={(name) =>
                  run(`rename:${player.id}`, () => api(`/players/${player.id}`, { method: 'PATCH', body: { name } }))
                }
                onRemove={() => run(`remove:${player.id}`, () => api(`/players/${player.id}`, { method: 'DELETE' }))}
              />
            ))}
          </ul>
          <AddForm
            label="Add a player"
            placeholder="Name"
            maxLength={40}
            button="Add player"
            busy={busy}
            saving={pending === 'add-player'}
            onAdd={(name) => run('add-player', () => api('/players', { method: 'POST', body: { name } }))}
          />
        </Card>
      </section>

      <section>
        <Card title="Rounds" className="space-y-3">
          {state.rounds.length === 0 ? <p className="text-sm text-fg-muted">No rounds yet.</p> : null}
          <ul className="space-y-2">
            {state.rounds.map((round) => (
              <li key={round.id} className="space-y-3 rounded-xl border border-border bg-surface p-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-semibold text-fg">{round.eventName}</p>
                    <p className="break-words text-sm text-fg-muted">
                      {formatDateRange(round.startDate, round.endDate)} · {round.eventKey}
                    </p>
                    <p className="text-sm text-fg-muted tabular-nums">
                      {round.totalPicks === 0 ? 'Draft not set up' : `${round.pickCount} of ${round.totalPicks} picks`}
                    </p>
                  </div>
                  <StatusBadge status={round.status} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button href={`/l/${slug}/admin/r/${round.id}`}>Manage round</Button>
                  <Button
                    type="button"
                    variant="danger"
                    busy={pending === `delete:${round.id}`}
                    disabled={busy}
                    onClick={() => {
                      const sure = window.confirm(
                        `Delete ${round.eventName}? This also deletes its picks and adjustments. It can't be undone.`,
                      );
                      if (sure) {
                        run(`delete:${round.id}`, () => api(`/rounds/${round.id}`, { method: 'DELETE' }), 'Round deleted.');
                      }
                    }}
                  >
                    {pending === `delete:${round.id}` ? null : <Trash2 className="size-4 shrink-0" />}
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <AddRoundForm
            busy={busy}
            checking={pending === 'check-round'}
            saving={pending === 'add-round'}
            onCheck={lookUpEvent}
            onAdd={(eventKey) =>
              run('add-round', async () => {
                const out = await api<{ round: { eventName: string; startDate: string; endDate: string } }>(
                  '/rounds',
                  { method: 'POST', body: { eventKey } },
                );
                setNotice(
                  `Added ${out.round.eventName} (${formatDateRange(out.round.startDate, out.round.endDate)}). Wrong event? Delete it above.`,
                );
              })
            }
          />
          <p className="text-xs text-fg-muted">
            The event key is the last part of the event&apos;s address on thebluealliance.com, such as 2026parr.
          </p>
        </Card>
      </section>

      <section>
        <Card title="Default scoring" className="space-y-3">
          <p className="text-sm text-fg-muted">
            New rounds copy these values. Changing them does not change rounds that already exist.
          </p>
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl border border-primary/40 bg-surface px-4 font-semibold text-primary motion-safe:transition-colors duration-200 hover:bg-surface-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
              Edit default scoring
              <ChevronDown className="size-5 shrink-0 motion-safe:transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <div className="pt-4">
              <ScoringForm
                initial={state.league.defaultScoring}
                saveLabel="Save default scoring"
                onSave={async (defaultScoring) => {
                  await api('/league', { method: 'PATCH', body: { defaultScoring } });
                  await reload();
                }}
              />
            </div>
          </details>
        </Card>
      </section>
    </main>
  );
}
