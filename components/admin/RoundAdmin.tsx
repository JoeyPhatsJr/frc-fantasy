'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdjustmentEditor } from '@/components/admin/AdjustmentEditor';
import { AdminGate } from '@/components/admin/AdminGate';
import { DraftEntry } from '@/components/admin/DraftEntry';
import { LiveDraftControls } from '@/components/admin/LiveDraftControls';
import { DETAILS_SUMMARY, RoundSetup } from '@/components/admin/RoundSetup';
import { usePending } from '@/components/admin/usePending';
import { usePolling } from '@/components/admin/usePolling';
import { StatusBadge } from '@/components/StatusBadge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Check, ChevronDown, ChevronLeft, RefreshCw, X } from '@/components/ui/icons';
import type { AdminApi } from '@/lib/admin/client';
import type { AdminRoundDetail } from '@/lib/api/types';
import { agoLabel, formatDateRange } from '@/lib/format';

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

  const { pending, go } = usePending(run);

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
  const { round } = detail;

  return (
    <main id="main" className="space-y-6">
      <header className="space-y-3">
        {/* The league bar shows the league name and "Commissioner"; this is the compact way back. */}
        <Link
          href={`/l/${slug}/admin`}
          className="-ml-2 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg pr-3 pl-1 text-[15px] font-semibold text-primary motion-safe:transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-5 shrink-0" />
          Dashboard
        </Link>
        <h1 className="break-words font-display text-[28px] font-bold leading-[30px] text-fg">{round.eventName}</h1>
        <div className="space-y-0.5">
          <p className="text-[15px] font-medium text-fg-muted">{formatDateRange(round.startDate, round.endDate)}</p>
          <p className="break-words text-[13px] leading-[18px] text-fg-muted">{round.eventKey}</p>
        </div>
        <div>
          <StatusBadge status={detail.status} />
        </div>
        <div>
          <Button href={`/l/${slug}/r/${round.id}`} variant="secondary">
            View public round page
          </Button>
        </div>
      </header>

      {detail.nudgeFinalize ? (
        <Alert tone="warning">Event&apos;s over — mark final once results look complete.</Alert>
      ) : null}

      {/* Sticks under the top bar, so a pick that fails (say, another tab drafted first) is seen mid-draft. */}
      {error || notice ? (
        <div className="sticky top-16 z-20 flex items-start gap-2 rounded-xl bg-surface shadow-card">
          <div className="min-w-0 flex-1">
            {error ? <Alert tone="danger">{error}</Alert> : <Alert tone="success">{notice}</Alert>}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Dismiss message"
            onClick={() => {
              setError(null);
              setNotice(null);
            }}
          >
            <X className="size-5" />
          </Button>
        </div>
      ) : null}

      <section>
        <Card title="Setup">
          <details className="group" open={detail.status === 'setup'}>
            <summary className={DETAILS_SUMMARY}>
              <span className="min-w-0">Roster size, draft order, team pool, scoring</span>
              <ChevronDown className="size-5 shrink-0 motion-safe:transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <div className="pt-4">
              <RoundSetup key={`${round.draftOrder.join(',')}|${round.rosterSize}`} {...section} />
            </div>
          </details>
        </Card>
      </section>

      <section>
        <Card title="Live draft">
          <LiveDraftControls {...section} slug={slug} />
        </Card>
      </section>

      <section>
        <Card title="Draft">
          <DraftEntry {...section} />
        </Card>
      </section>

      <section>
        <Card title="Adjustments">
          <AdjustmentEditor {...section} />
        </Card>
      </section>

      <section>
        <Card title="Data and status" className="space-y-3">
          <div className="flex flex-wrap gap-2">
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
                  setNotice(
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
            {round.finalizedAt ? (
              <Button
                type="button"
                variant="secondary"
                busy={pending === 'finalize'}
                disabled={busy}
                onClick={() =>
                  go(
                    'finalize',
                    () => api(`/rounds/${round.id}`, { method: 'PATCH', body: { finalized: false } }),
                    'Round reopened.',
                  )
                }
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
          <p className="text-xs text-fg-muted">
            Refresh is limited to once every 15 seconds. Marking final only changes the badge and slows down
            checks for new data; scores are always computed from The Blue Alliance.
          </p>
        </Card>
      </section>
    </main>
  );
}
