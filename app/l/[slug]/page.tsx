import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AutoRefresh } from '@/components/AutoRefresh';
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
      {page.anyLive ? <AutoRefresh seconds={60} /> : null}

      <header className="space-y-3">
        <h1 className="break-words font-display text-4xl font-bold uppercase leading-tight tracking-wide text-fg">
          {league.name}
        </h1>
        {rounds.length > 0 ? <Freshness fetchedAt={page.fetchedAt} stale={page.stale} now={now} /> : null}
      </header>

      {live.map((view) => (
        <section key={view.round.id}>
          <Card
            title={view.round.eventName}
            action={<StatusBadge status={view.status} />}
            className="ring-2 ring-success"
          >
            <Leaderboard
              rows={view.scores.map((s) => ({ id: s.playerId, rank: s.rank, name: s.name, total: s.total }))}
              emptyText="No players in this round yet."
            />
            <Button href={`/l/${league.slug}/r/${view.round.id}`} variant="secondary" className="mt-4">
              See rosters and breakdowns
            </Button>
          </Card>
        </section>
      ))}

      <section>
        <Card title="Season standings">
          <Leaderboard
            rows={standings.map((s) => ({
              id: s.playerId,
              rank: s.rank,
              name: s.name,
              total: s.total,
              detail: s.perRound.length > 1 ? s.perRound.join(' · ') : undefined,
            }))}
            emptyText="No players yet. The commissioner adds them."
          />
          {rounds.length > 1 ? (
            <p className="mt-3 text-xs text-fg-muted">Small numbers are points per round, in date order.</p>
          ) : null}
        </Card>
      </section>

      <section>
        <Card title="Rounds">
          {rounds.length === 0 ? (
            <p className="text-sm text-fg-muted">No rounds yet. The commissioner adds them.</p>
          ) : (
            <ul className="space-y-2">
              {rounds.map((view) => (
                <li key={view.round.id}>
                  <Link
                    href={`/l/${league.slug}/r/${view.round.id}`}
                    className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2 motion-safe:transition-colors duration-200 hover:border-primary/40 hover:bg-surface-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-fg" title={view.round.eventName}>
                        {view.round.eventName}
                      </span>
                      <span className="block text-sm text-fg-muted">
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
