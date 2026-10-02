'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AddManualRoundForm, type ManualRoundInput } from '@/components/admin/AddManualRoundForm';
import { AddRoundForm, RenameLeague, RoundRows, VisibilityField } from '@/components/admin/DashboardParts';
import { AdminGate } from '@/components/admin/AdminGate';
import { DangerZone } from '@/components/admin/DangerZone';
import type { UpcomingEvent } from '@/components/admin/EventPicker';
import { FollowTeamsForm } from '@/components/admin/FollowTeamsForm';
import { InviteCard } from '@/components/admin/InviteCard';
import { MembersCard } from '@/components/admin/MembersCard';
import { DETAILS_SUMMARY } from '@/components/admin/RoundSetup';
import { ScoringForm } from '@/components/admin/ScoringForm';
import { usePolling } from '@/components/admin/usePolling';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ChevronDown } from '@/components/ui/icons';
import { Section } from '@/components/ui/Section';
import type { AdminApi } from '@/lib/admin/client';
import type { AdminState, EventLookup } from '@/lib/api/types';
import { formatDateRange } from '@/lib/format';
import { nextSeasonYear } from '@/lib/season/next';

export const FIRST_ROUND_FAILED = "Your league is ready, but the first round couldn't be added. Add it under Events below.";

/**
 * firstRoundFailed: /leagues/new made the league but couldn't add the prefilled event (?round_error=1).
 * upcoming: the next TBA events for the "Add an event" picker (empty when TBA is unreachable).
 */
export function AdminDashboard({
  slug,
  firstRoundFailed = false,
  upcoming = [],
}: {
  slug: string;
  firstRoundFailed?: boolean;
  upcoming?: UpcomingEvent[];
}) {
  return (
    <AdminGate slug={slug}>
      {(api) => <Dashboard slug={slug} api={api} firstRoundFailed={firstRoundFailed} upcoming={upcoming} />}
    </AdminGate>
  );
}

function Dashboard({
  slug,
  api,
  firstRoundFailed,
  upcoming,
}: {
  slug: string;
  api: AdminApi;
  firstRoundFailed: boolean;
  upcoming: UpcomingEvent[];
}) {
  const [state, setState] = useState<AdminState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [roundWarning, setRoundWarning] = useState(firstRoundFailed);
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

  return (
    <main id="main" className="space-y-8">
      {/* The league header shows the name and "Commissioner"; this keeps a page heading for screen readers. */}
      <h1 className="sr-only">Commissioner dashboard for {state.league.name}</h1>
      {roundWarning || error || notice ? (
        <div className="space-y-3">
          {roundWarning ? <Alert tone="warning">{FIRST_ROUND_FAILED}</Alert> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {notice ? <Alert tone="success">{notice}</Alert> : null}
        </div>
      ) : null}
      <DashboardBody
        slug={slug}
        state={state}
        upcoming={upcoming}
        busy={busy}
        pending={pending}
        run={run}
        api={api}
        lookUpEvent={lookUpEvent}
        reload={reload}
        setNotice={setNotice}
      />
    </main>
  );
}

export type DashboardBodyProps = {
  slug: string;
  state: AdminState;
  upcoming: UpcomingEvent[];
  busy: boolean;
  pending: string | null;
  run: (key: string, action: () => Promise<unknown>, done?: string) => Promise<boolean>;
  api: AdminApi;
  lookUpEvent: (eventKey: string) => Promise<EventLookup | null>;
  reload: () => Promise<void>;
  setNotice: (notice: string | null) => void;
};

/**
 * The league admin page, top to bottom (spec §7.1): Invite people → Events (or Season) → Members →
 * Settings → Danger zone. Only builds markup from what it's given; the state and calls live in Dashboard.
 */
export function DashboardBody({ slug, state, upcoming, busy, pending, run, api, lookUpEvent, reload, setNotice }: DashboardBodyProps) {
  const { league } = state;
  const inLeague = new Set(state.rounds.map((r) => r.eventKey));
  return (
    <>
      <InviteCard
        leagueName={league.name}
        code={league.inviteCode}
        busy={busy}
        resetting={pending === 'reset'}
        onReset={() => {
          if (window.confirm('Make a new code? The old code and link stop working.')) {
            run('reset', () => api('/invite', { method: 'POST' }), 'New invite code made. The old one no longer works.');
          }
        }}
      />

      {league.format === 'season' ? (
        <Section label="Season">
          <RoundRows slug={slug} rounds={state.rounds} follows={league.follows} />
          <div className="px-4 py-4">
            {(() => {
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
            })()}
          </div>
        </Section>
      ) : (
        <div className="space-y-6">
          <Section label="Events">
            {state.rounds.length === 0 ? (
              <p className="px-4 py-4 text-[15px] text-fg-muted">No events yet. Add one below.</p>
            ) : (
              <RoundRows slug={slug} rounds={state.rounds} follows={league.follows} />
            )}
          </Section>
          <AddRoundForm
            upcoming={upcoming.filter((e) => !inLeague.has(e.key))}
            busy={busy}
            checking={pending === 'check-round'}
            saving={pending === 'add-round'}
            onCheck={lookUpEvent}
            onAdd={(eventKey) =>
              run('add-round', async () => {
                const out = await api<{ round: { eventName: string; startDate: string; endDate: string } }>('/rounds', {
                  method: 'POST',
                  body: { eventKey },
                });
                setNotice(
                  `Added ${out.round.eventName} (${formatDateRange(out.round.startDate, out.round.endDate)}). Wrong event? Open it under Events to delete it.`,
                );
              })
            }
          />
          <details className="group">
            <summary className={DETAILS_SUMMARY}>
              More ways to add events
              <ChevronDown className="size-5 shrink-0 motion-safe:transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <div className="space-y-6 pt-4">
              <div className="space-y-3">
                <h3 className="font-display text-[17px] font-bold leading-6 text-fg">Manual event</h3>
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
              </div>
              <div className="space-y-3 border-t border-border pt-6">
                <h3 className="font-display text-[17px] font-bold leading-6 text-fg">Follow teams</h3>
                <FollowTeamsForm
                  key={league.follows.join(',')}
                  follows={league.follows}
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
              </div>
            </div>
          </details>
        </div>
      )}

      <MembersCard
        players={state.players}
        me={state.me}
        busy={busy}
        pending={pending}
        onRole={(id, role) => run(`role:${id}`, () => api(`/players/${id}`, { method: 'PATCH', body: { role } }))}
        onRemove={(p) => run(`remove:${p.id}`, () => api(`/players/${p.id}`, { method: 'DELETE' }), `${p.name} was removed.`)}
      />

      <Section label="Settings">
        <div className="space-y-6 px-4 py-4">
          <RenameLeague
            key={league.name}
            name={league.name}
            busy={busy}
            saving={pending === 'league'}
            onSave={(name) => run('league', () => api('/league', { method: 'PATCH', body: { name } }), 'League renamed.')}
          />
          <VisibilityField
            visibility={league.visibility}
            busy={busy}
            onChange={(visibility) => run('visibility', () => api('/league', { method: 'PATCH', body: { visibility } }))}
          />
          <details className="group">
            <summary className={DETAILS_SUMMARY}>
              Default scoring
              <ChevronDown className="size-5 shrink-0 motion-safe:transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <div className="space-y-4 pt-4">
              <p className="text-[15px] text-fg-muted">
                New rounds copy these values. Changing them does not change rounds that already exist.
              </p>
              <ScoringForm
                initial={league.defaultScoring}
                saveLabel="Save default scoring"
                onSave={async (defaultScoring) => {
                  await api('/league', { method: 'PATCH', body: { defaultScoring } });
                  await reload();
                }}
              />
            </div>
          </details>
        </div>
      </Section>

      <DangerZone
        leagueName={league.name}
        busy={busy}
        onDelete={(confirmName) =>
          run('delete-league', async () => {
            await api('/league', { method: 'DELETE', body: { confirmName } });
            window.location.assign('/leagues');
          })
        }
      />
    </>
  );
}
