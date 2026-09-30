'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdjustmentEditor } from '@/components/admin/AdjustmentEditor';
import { AdminGate } from '@/components/admin/AdminGate';
import { DraftEntry } from '@/components/admin/DraftEntry';
import { DETAILS_SUMMARY, RoundSetup } from '@/components/admin/RoundSetup';
import { usePending } from '@/components/admin/usePending';
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

  const reload = useCallback(async () => {
    setDetail(await api<AdminRoundDetail>(`/rounds/${roundId}`));
  }, [api, roundId]);

  useEffect(() => {
    reload().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Something went wrong'));
  }, [reload]);

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
        <Button href={`/l/${slug}/admin`} variant="ghost" className="-ml-3">
          <ChevronLeft className="size-5 shrink-0" />
          Commissioner dashboard
        </Button>
        <p className="text-xs font-bold uppercase tracking-wider text-secondary">Commissioner</p>
        <div className="flex items-start gap-3">
          <h1 className="min-w-0 flex-1 break-words font-display text-3xl font-bold uppercase leading-tight tracking-wide text-fg">
            {round.eventName}
          </h1>
          <StatusBadge status={detail.status} />
        </div>
        <p className="break-words text-sm font-medium text-fg-muted">
          {formatDateRange(round.startDate, round.endDate)} · {round.eventKey}
        </p>
        <Button href={`/l/${slug}/r/${round.id}`} variant="secondary">
          View public round page
        </Button>
      </header>

      {detail.nudgeFinalize ? (
        <Alert tone="warning">Event&apos;s over — mark final once results look complete.</Alert>
      ) : null}

      {/* Sticks under the top bar, so a pick that fails (say, another tab drafted first) is seen mid-draft. */}
      {error || notice ? (
        <div className="sticky top-16 z-10 flex items-start gap-2 rounded-xl bg-surface shadow-card">
          <div className="min-w-0 flex-1">
            {error ? <Alert tone="danger">{error}</Alert> : <Alert tone="success">{notice}</Alert>}
          </div>
          <Button
            type="button"
            variant="ghost"
            className="size-11 shrink-0 px-0"
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
