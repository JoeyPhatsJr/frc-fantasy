'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AddManualRoundForm, type ManualRoundInput } from '@/components/admin/AddManualRoundForm';
import { AddRoundForm, EventRow, RenameLeague } from '@/components/admin/DashboardParts';
import { AdminGate } from '@/components/admin/AdminGate';
import { DangerZone } from '@/components/admin/DangerZone';
import { FollowTeamsForm } from '@/components/admin/FollowTeamsForm';
import { MembersCard } from '@/components/admin/MembersCard';
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
import { autoAddedNote } from '@/lib/follow/input';
import { formatDateRange } from '@/lib/format';
import { nextSeasonYear } from '@/lib/season/next';

/** Members-only leagues have no public page, so the shortcuts don't call it one. */
export function leagueLinkLabels(visibility: 'link' | 'members'): { view: string; copy: string } {
  return visibility === 'link'
    ? { view: 'View public page', copy: 'Copy public link' }
    : { view: 'View league page', copy: 'Copy league link' };
}

export const FIRST_ROUND_FAILED = "Your league is ready, but the first round couldn't be added. Add it under Rounds below.";

/** firstRoundFailed: /leagues/new made the league but couldn't add the prefilled event (?round_error=1). */
export function AdminDashboard({ slug, firstRoundFailed = false }: { slug: string; firstRoundFailed?: boolean }) {
  return (
    <AdminGate slug={slug}>{(api) => <Dashboard slug={slug} api={api} firstRoundFailed={firstRoundFailed} />}</AdminGate>
  );
}

function Dashboard({ slug, api, firstRoundFailed }: { slug: string; api: AdminApi; firstRoundFailed: boolean }) {
  const [state, setState] = useState<AdminState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [roundWarning, setRoundWarning] = useState(firstRoundFailed);
  /** Which action is running (it shows the spinner); every other control is disabled meanwhile. */
  const [pending, setPending] = useState<string | null>(null);
  const busy = pending !== null;
  const [addKind, setAddKind] = useState<'tba' | 'manual'>('tba');

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
      setRoundWarning(false);
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

  const leagueLink = typeof window === 'undefined' ? '' : `${window.location.origin}/l/${slug}`;
  const labels = leagueLinkLabels(state.league.visibility);

  return (
    <main id="main" className="space-y-6">
      {/* The league bar (app/l/[slug]/layout.tsx) shows the name and "Commissioner"; this keeps a page heading for screen readers. */}
      <h1 className="sr-only">Commissioner dashboard for {state.league.name}</h1>
      <div className="flex flex-wrap items-center gap-2">
        <Button href={`/l/${slug}`} variant="secondary">
          {labels.view}
        </Button>
        <CopyButton text={leagueLink} label={labels.copy} />
      </div>

      {roundWarning ? <Alert tone="warning">{FIRST_ROUND_FAILED}</Alert> : null}
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
        <MembersCard
          inviteLink={typeof window === 'undefined' ? '' : `${window.location.origin}/join/${state.league.inviteCode}`}
          league={state.league}
          players={state.players}
          me={state.me}
          busy={busy}
          pending={pending}
          onReset={() => run('reset', () => api('/invite', { method: 'POST' }), 'New invite code made. The old one no longer works.')}
          onVisibility={(visibility) => run('visibility', () => api('/league', { method: 'PATCH', body: { visibility } }))}
          onRole={(id, role) => run(`role:${id}`, () => api(`/players/${id}`, { method: 'PATCH', body: { role } }))}
          onRemove={(p) => run(`remove:${p.id}`, () => api(`/players/${p.id}`, { method: 'DELETE' }), `${p.name} was removed.`)}
        />
      </section>

      <section>
        <Card title="Rounds" className="space-y-3">
          {state.rounds.length === 0 ? <p className="text-[15px] text-fg-muted">No rounds yet.</p> : null}
          <ul className="-mx-2 divide-y divide-border">
            {state.rounds.map((round) => (
              <li
                key={round.id}
                className="space-y-3 rounded-lg px-2 py-3 motion-safe:transition-colors duration-200 hover:bg-fg/5"
              >
                <EventRow
                  startDate={round.startDate}
                  title={round.eventName}
                  lines={[
                    formatDateRange(round.startDate, round.endDate),
                    round.eventKey ?? (round.kind === 'manual' ? 'Manual event' : `${round.seasonYear} season`),
                    round.totalPicks === 0 ? 'Draft not set up' : `${round.pickCount} of ${round.totalPicks} picks`,
                    ...(round.autoAdded ? [autoAddedNote(state.league.follows)] : []),
                  ]}
                  trailing={<StatusBadge status={round.status} />}
                />
                <div className="flex flex-wrap gap-2 pl-15">
                  <Button href={`/l/${slug}/admin/r/${round.id}`} aria-label={`Manage ${round.eventName}`}>
                    Manage
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    aria-label={`Delete ${round.eventName}`}
                    busy={pending === `delete:${round.id}`}
                    disabled={busy}
                    onClick={() => {
                      const sure = window.confirm(
                        `Delete ${round.eventName}? This also deletes its picks and adjustments. It can't be undone.` +
                          (round.autoAdded ? ' Follow-a-team won’t add it again.' : ''),
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
          {state.league.format === 'season' ? (
            (() => {
              const next = nextSeasonYear(state.rounds);
              return next === null ? (
                <p className="text-[13px] leading-[18px] text-fg-muted">
                  Full-season leagues have one round per season. Mark this season final to start the next one.
                </p>
              ) : (
                <Button
                  type="button"
                  variant="accent"
                  busy={pending === 'next-season'}
                  disabled={busy}
                  onClick={() => run('next-season', () => api('/seasons', { method: 'POST' }), `Started the ${next} season.`)}
                >
                  Start {next} season
                </Button>
              );
            })()
          ) : null}
          {state.league.format === 'event' ? (
            <div className="space-y-3">
              <FollowTeamsForm
                key={state.league.follows.join(',')}
                follows={state.league.follows}
                busy={busy}
                saving={pending === 'follows'}
                onSave={(teams) =>
                  run('follows', async () => {
                    const out = await api<{ added: number; synced: boolean }>('/follows', { method: 'PUT', body: { teams } });
                    setNotice(
                      !out.synced
                        ? "Saved. Couldn't reach The Blue Alliance — new events will be added on the next check."
                        : out.added > 0
                          ? `Saved. Added ${out.added} ${out.added === 1 ? 'round' : 'rounds'}.`
                          : 'Saved.',
                    );
                  })
                }
              />
              <div role="group" aria-label="Kind of round to add" className="flex gap-2">
                {(['tba', 'manual'] as const).map((kind) => (
                  <Button
                    key={kind}
                    type="button"
                    size="sm"
                    variant={addKind === kind ? 'primary' : 'secondary'}
                    aria-pressed={addKind === kind}
                    onClick={() => setAddKind(kind)}
                  >
                    {kind === 'tba' ? 'TBA event' : 'Manual event'}
                  </Button>
                ))}
              </div>
              {addKind === 'tba' ? (
                <>
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
                  <p className="text-[13px] leading-[18px] text-fg-muted">
                    The event key is the last part of the event&apos;s address on thebluealliance.com, such as 2026parr.
                  </p>
                </>
              ) : (
                <AddManualRoundForm
                  busy={busy}
                  saving={pending === 'add-manual'}
                  onAdd={(input: ManualRoundInput) =>
                    run(
                      'add-manual',
                      () => api('/rounds', { method: 'POST', body: { kind: 'manual', ...input } }),
                      `Added ${input.name}. Add its teams under Manage → Setup.`,
                    )
                  }
                />
              )}
            </div>
          ) : null}
        </Card>
      </section>

      <section>
        <Card title="Default scoring" className="space-y-3">
          <p className="text-[15px] text-fg-muted">
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

      <section>
        <DangerZone
          leagueName={state.league.name}
          busy={busy}
          onDelete={(confirmName) =>
            run('delete-league', async () => {
              await api('/league', { method: 'DELETE', body: { confirmName } });
              window.location.assign('/leagues');
            })
          }
        />
      </section>
    </main>
  );
}
