'use client';

import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { AdjustmentEditor } from '@/components/admin/AdjustmentEditor';
import { AdminGate } from '@/components/admin/AdminGate';
import { DraftEntry } from '@/components/admin/DraftEntry';
import { DraftModeSwitch, LiveDraftControls } from '@/components/admin/LiveDraftControls';
import { ManualResultsEditor } from '@/components/admin/ManualResultsEditor';
import { type ChecklistStep, RoundChecklist, stepSummaries } from '@/components/admin/RoundChecklist';
import { RoundSetup } from '@/components/admin/RoundSetup';
import { usePending } from '@/components/admin/usePending';
import { usePolling } from '@/components/admin/usePolling';
import { StatusBadge } from '@/components/StatusBadge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Check, ChevronLeft, RefreshCw, Trash2, X } from '@/components/ui/icons';
import type { AdminApi } from '@/lib/admin/client';
import { type AdminStep, adminStep, setupDone } from '@/lib/admin/steps';
import type { AdminRoundDetail } from '@/lib/api/types';
import { agoLabel, formatDateRange, roundKeyLine } from '@/lib/format';

export type SectionProps = {
  detail: AdminRoundDetail;
  busy: boolean;
  run: (action: () => Promise<unknown>, done?: string) => Promise<void>;
  api: AdminApi;
  playerNames: Record<string, string>;
};

export function RoundAdmin({ slug, roundId }: { slug: string; roundId: string }) {
  return <AdminGate slug={slug}>{(api) => <RoundManager slug={slug} roundId={roundId} api={api} />}</AdminGate>;
}

function RoundManager({ slug, roundId, api }: { slug: string; roundId: string; api: AdminApi }) {
  const [detail, setDetail] = useState<AdminRoundDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Counts reloads, so a slow background poll can't overwrite the fresher state a change just loaded. */
  const latestReload = useRef(0);
  const reload = useCallback(async () => {
    const n = ++latestReload.current;
    const next = await api<AdminRoundDetail>(`/rounds/${roundId}`);
    if (n === latestReload.current) setDetail(next);
  }, [api, roundId]);

  useEffect(() => {
    reload().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Something went wrong'));
  }, [reload]);

  // Picks up picks made on another device. Paused while a change runs; `run` reloads when it finishes.
  usePolling(reload, 30_000, { paused: busy });

  /** Runs one change, then reloads. A 409 from another tab shows its message and the fresh state. */
  const run = useCallback(
    async (action: () => Promise<unknown>, done?: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await action();
        if (done) setNotice(done);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        await reload().catch(() => {});
        setBusy(false);
      }
    },
    [reload],
  );

  if (!detail) {
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

  const playerNames = Object.fromEntries(detail.players.map((p) => [p.id, p.name]));
  const section: SectionProps = { detail, busy, run, api, playerNames };

  return (
    <RoundAdminView
      slug={slug}
      section={section}
      error={error}
      notice={notice}
      onNotice={setNotice}
      onDismiss={() => {
        setError(null);
        setNotice(null);
      }}
    />
  );
}

const SUBHEAD = 'font-display text-[17px] font-bold leading-6 text-fg';

/**
 * Round admin (UX spec §7.2): a header, the sticky error/notice, then the four-step checklist opened on
 * `adminStep()`, and "Delete this event" at the very bottom. Every call and confirm is the one the old
 * card layout made; only the arrangement changed.
 */
export function RoundAdminView({
  slug,
  section,
  error,
  notice,
  onNotice,
  onDismiss,
}: {
  slug: string;
  section: SectionProps;
  error: string | null;
  notice: string | null;
  onNotice: (message: string) => void;
  onDismiss: () => void;
}) {
  const { detail } = section;
  const { round } = detail;
  const playerIds = detail.players.map((p) => p.id);
  const current = adminStep(detail.status, setupDone(round, playerIds));
  const lines = stepSummaries({
    playerCount: round.draftOrder.length,
    rosterSize: round.rosterSize,
    picks: detail.picks.length,
    kind: round.kind,
    manualResults: detail.manualResults?.length ?? 0,
    finalized: round.finalizedAt !== null,
  });
  const content: Record<AdminStep, ReactNode> = {
    1: <RoundSetup key={`${round.draftOrder.join(',')}|${round.rosterSize}`} {...section} />,
    2: <DraftStep {...section} slug={slug} />,
    3: <EventStep {...section} onNotice={onNotice} />,
    4: <WrapUpStep {...section} />,
  };
  const steps: ChecklistStep[] = ([1, 2, 3, 4] as const).map((s) => ({ step: s, ...lines[s], content: content[s] }));

  return (
    <main id="main" className="space-y-6">
      <header className="space-y-3">
        {/* The league bar shows the league name and "Commissioner"; this is the compact way back. */}
        <Link
          href={`/l/${slug}/admin`}
          className="-ml-2 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg pr-3 pl-1 text-[15px] font-semibold text-primary motion-safe:transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-5 shrink-0" />
          Admin
        </Link>
        <h1 className="break-words font-display text-[28px] font-bold leading-[30px] text-fg">{round.eventName}</h1>
        <div className="space-y-0.5">
          <p className="text-[15px] font-medium text-fg-muted">{formatDateRange(round.startDate, round.endDate)}</p>
          <p className="break-words text-[13px] leading-[18px] text-fg-muted">{roundKeyLine(round)}</p>
        </div>
        <div>
          <StatusBadge status={detail.status} />
        </div>
      </header>

      {/* Sticks under the top bar, so a pick that fails (say, another tab drafted first) is seen mid-draft. */}
      {error || notice ? (
        <div className="sticky top-16 z-20 flex items-start gap-2 rounded-xl bg-surface shadow-card">
          <div className="min-w-0 flex-1">
            {error ? <Alert tone="danger">{error}</Alert> : <Alert tone="success">{notice}</Alert>}
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Dismiss message" onClick={onDismiss}>
            <X className="size-5" />
          </Button>
        </div>
      ) : null}

      <RoundChecklist current={current} steps={steps} />

      <DeleteRound {...section} slug={slug} />
    </main>
  );
}

/**
 * Step 2: only the chosen draft method, plus "Switch to …". A finished live draft also gets DraftEntry,
 * for its "Fix a pick" list (a team that withdrew).
 */
function DraftStep(props: SectionProps & { slug: string }) {
  const { round, picks } = props.detail;
  const live = round.draftMode === 'live';
  const total = round.draftOrder.length * round.rosterSize;
  const complete = total > 0 && picks.length >= total;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="flex min-h-9 items-center text-[15px] text-fg-muted">
          {live ? 'Live draft on everyone’s phones.' : 'You enter the picks here.'}
        </p>
        <DraftModeSwitch {...props} />
      </div>
      {live ? <LiveDraftControls {...props} /> : <DraftEntry {...props} />}
      {live && complete ? <DraftEntry {...props} /> : null}
    </div>
  );
}

/** Step 3: Refresh from TBA (TBA rounds; the refresh API serves only those), typed-in results, adjustments. */
function EventStep(props: SectionProps & { onNotice: (message: string) => void }) {
  const { detail, busy, run, api, onNotice } = props;
  const { round } = detail;
  const { pending, go } = usePending(run);
  return (
    <div className="space-y-8">
      {round.kind === 'tba' ? (
        <div className="space-y-2">
          <Button
            type="button"
            variant="secondary"
            busy={pending === 'refresh'}
            disabled={busy}
            onClick={() =>
              go('refresh', async () => {
                const out = await api<{ fetchedAt: string | null; stale: boolean }>(`/rounds/${round.id}/refresh`, {
                  method: 'POST',
                });
                onNotice(
                  out.stale
                    ? `Couldn't reach The Blue Alliance. Showing data from ${agoLabel(out.fetchedAt, new Date())}.`
                    : `Refreshed from The Blue Alliance (${agoLabel(out.fetchedAt, new Date())}).`,
                );
              })
            }
          >
            {pending === 'refresh' ? null : <RefreshCw className="size-4 shrink-0" />}
            Refresh from TBA
          </Button>
          <p className="text-xs text-fg-muted">Refresh is limited to once every 15 seconds.</p>
        </div>
      ) : null}
      {round.kind === 'manual' ? (
        <div className="space-y-3">
          <h3 className={SUBHEAD}>Results</h3>
          <ManualResultsEditor {...props} />
        </div>
      ) : null}
      <div className="space-y-3">
        <h3 className={SUBHEAD}>Adjustments</h3>
        <AdjustmentEditor {...props} />
      </div>
    </div>
  );
}

/** Step 4 (spec 2026-10-02 §7): what auto-finalize will do, then Mark round final / Reopen round. */
function WrapUpStep({ detail, busy, run, api }: SectionProps) {
  const { round } = detail;
  const { pending, go } = usePending(run);
  const note = round.finalizedAt
    ? 'Final. Scores still update if TBA changes; adjustments still work.'
    : round.autoFinalize
      ? 'This round finalizes on its own once the playoffs are done (or 3 days after the event). Mark it final now if results look complete.'
      : 'Auto-finalize is off for this round.';
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">{note}</p>
      <div className="flex flex-wrap gap-2">
        {round.finalizedAt ? (
          <Button
            type="button"
            variant="secondary"
            busy={pending === 'finalize'}
            disabled={busy}
            onClick={() => {
              if (!window.confirm('Reopening keeps this round open until you mark it final again.')) return;
              void go(
                'finalize',
                () => api(`/rounds/${round.id}`, { method: 'PATCH', body: { finalized: false } }),
                'Round reopened — it stays open until you mark it final.',
              );
            }}
          >
            Reopen round
          </Button>
        ) : (
          <Button
            type="button"
            busy={pending === 'finalize'}
            disabled={busy}
            onClick={() =>
              go(
                'finalize',
                () => api(`/rounds/${round.id}`, { method: 'PATCH', body: { finalized: true } }),
                'Round marked final.',
              )
            }
          >
            {pending === 'finalize' ? null : <Check className="size-4 shrink-0" />}
            Mark round final
          </Button>
        )}
      </div>
    </div>
  );
}

/** Moved here from the dashboard's event rows (spec §7.2): same DELETE call and confirm, then back to Admin. */
function DeleteRound({ detail, busy, run, api, slug }: SectionProps & { slug: string }) {
  const { round } = detail;
  const { pending, go } = usePending(run);
  return (
    <div className="flex flex-col items-start gap-1 border-t border-border pt-4">
      <Button
        type="button"
        variant="danger"
        size="sm"
        busy={pending === 'delete'}
        disabled={busy}
        onClick={() => {
          const sure = window.confirm(
            `Delete ${round.eventName}? This also deletes its picks and adjustments. It can't be undone.`,
          );
          if (sure) {
            go('delete', async () => {
              await api(`/rounds/${round.id}`, { method: 'DELETE' });
              window.location.assign(`/l/${slug}/admin`);
            });
          }
        }}
      >
        {pending === 'delete' ? null : <Trash2 className="size-4 shrink-0" />}
        {round.kind === 'season' ? 'Delete this season' : 'Delete this event'}
      </Button>
      <p className="text-[13px] leading-[18px] text-fg-muted">Also deletes its picks and adjustments.</p>
    </div>
  );
}
