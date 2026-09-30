import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AutoRefresh } from '@/components/AutoRefresh';
import { DateBlock } from '@/components/DateBlock';
import { Freshness } from '@/components/Freshness';
import { Leaderboard } from '@/components/Leaderboard';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatDateRange } from '@/lib/format';
import { loadLeaguePage } from '@/lib/views/league';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Props = { params: Promise<{ slug: string }> };

export default async function LeaguePage({ params }: Props) {
  const { slug } = await params;
  const now = new Date();
  const page = await loadLeaguePage(slug, now);
  if (!page) notFound();

  // Only { slug, name } of the league reaches this page; the admin token hash never does.
  const { league, standings, rounds } = page;
  const live = rounds.filter((r) => r.status === 'live');

  return (
    <main id="main" className="space-y-6">
      <AutoRefresh seconds={60} />

      {/* The league bar (app/l/[slug]/layout.tsx) shows the name; this keeps a page heading for screen readers. */}
      <h1 className="sr-only">{league.name} standings</h1>

      {live.map((view) => (
        <section key={view.round.id}>
          <Card
            className="ring-2 ring-success/60"
            title={
              <span className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full bg-success ring-4 ring-success/25 motion-safe:animate-pulse"
                />
                Live now
              </span>
            }
          >
            <p className="-mt-2 mb-2 truncate text-[15px] font-medium text-fg-muted" title={view.round.eventName}>
              {view.round.eventName}
            </p>
            <Leaderboard
              rows={view.scores
                .slice(0, 3)
                .map((s) => ({ id: s.playerId, rank: s.rank, name: s.name, total: s.total }))}
              emptyText="No players in this round yet."
            />
            <Button href={`/l/${league.slug}/r/${view.round.id}`} variant="secondary" className="mt-4">
              See rosters
            </Button>
          </Card>
        </section>
      ))}

      {rounds.length > 0 ? <Freshness fetchedAt={page.fetchedAt} stale={page.stale} now={now} /> : null}

      <section>
        <Card title="Season standings">
          <Leaderboard
            rows={standings.map((s) => ({
              id: s.playerId,
              rank: s.rank,
              name: s.name,
              total: s.total,
              detail: s.perRound.length > 1 ? s.perRound.join(' ') : undefined,
            }))}
            emptyText="No players yet. The commissioner adds them."
          />
          {rounds.length > 1 ? (
            <p className="mt-3 text-[13px] leading-[18px] text-fg-muted">
              Small numbers are points per round, in date order.
            </p>
          ) : null}
        </Card>
      </section>

      <section>
        <Card title="Rounds">
          {rounds.length === 0 ? (
            <p className="text-[15px] text-fg-muted">No rounds yet — the commissioner adds one from Admin</p>
          ) : (
            <ul className="-mx-2 divide-y divide-border">
              {rounds.map((view) => (
                <li key={view.round.id}>
                  <Link
                    href={`/l/${league.slug}/r/${view.round.id}`}
                    className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 motion-safe:transition-colors duration-200 hover:bg-surface-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <DateBlock date={view.round.startDate} />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-[17px] font-semibold leading-6 text-fg"
                        title={view.round.eventName}
                      >
                        {view.round.eventName}
                      </span>
                      <span className="block truncate text-[13px] leading-[18px] text-fg-muted">
                        {formatDateRange(view.round.startDate, view.round.endDate)}
                      </span>
                    </span>
                    <StatusBadge status={view.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </main>
  );
}
