import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AdjustmentList } from '@/components/AdjustmentList';
import { AutoRefresh } from '@/components/AutoRefresh';
import { DraftBoard } from '@/components/DraftBoard';
import { Freshness } from '@/components/Freshness';
import { Leaderboard } from '@/components/Leaderboard';
import { PrivateLeague } from '@/components/PrivateLeague';
import { RosterList } from '@/components/RosterList';
import { StatusBadge } from '@/components/StatusBadge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChevronLeft, ExternalLink, Info } from '@/components/ui/icons';
import { leagueAccess } from '@/lib/auth/roles';
import { formatDateRange, tbaEventUrl } from '@/lib/format';
import { loadRoundPage } from '@/lib/views/round';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Props = { params: Promise<{ slug: string; roundId: string }> };

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-fg-muted">
      <Info className="size-4 shrink-0" />
      {children}
    </p>
  );
}

export default async function RoundPage({ params }: Props) {
  const { slug, roundId } = await params;
  const access = await leagueAccess(slug);
  if (!access) notFound();
  if (!access.canView) {
    return <PrivateLeague signedIn={access.user !== null} next={`/l/${slug}/r/${roundId}`} />;
  }

  const now = new Date();
  const page = await loadRoundPage(slug, roundId, now);
  if (!page) notFound();

  // The league bar in app/l/[slug]/layout.tsx shows the league name; the back link below is the compact way home.
  const { league, view, playerNames } = page;
  const { round } = view;
  const draftInProgress = view.status === 'setup' || view.status === 'drafting';
  const notStarted = !view.hasEventData;
  const oprPending = view.hasEventData && !view.qualsComplete;
  const rpMissing = view.hasRankings && view.rpMethod === 'none';

  return (
    <main id="main" className="space-y-6">
      <AutoRefresh seconds={60} />

      <header className="space-y-3">
        <Link
          href={`/l/${league.slug}`}
          className="-ml-2 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg pr-3 pl-1 text-[15px] font-semibold text-primary motion-safe:transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-5 shrink-0" />
          Standings
        </Link>
        <h1 className="break-words font-display text-[28px] font-bold leading-[30px] text-fg">{round.eventName}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <StatusBadge status={view.status} />
          <p className="text-[15px] font-medium text-fg-muted">{formatDateRange(round.startDate, round.endDate)}</p>
        </div>
        <Button
          href={tbaEventUrl(round.eventKey)}
          variant="secondary"
          size="sm"
          target="_blank"
          rel="noopener noreferrer"
        >
          View on The Blue Alliance
          <ExternalLink className="size-4 shrink-0" />
        </Button>
        <Freshness fetchedAt={view.fetchedAt} stale={view.stale} now={now} />
      </header>

      {notStarted || oprPending || rpMissing ? (
        <div className="space-y-2">
          {notStarted ? <Alert tone="info">Event hasn&apos;t started</Alert> : null}
          {oprPending ? <Note>OPR bonus: after quals</Note> : null}
          {rpMissing ? <Note>RP data unavailable for this event</Note> : null}
        </div>
      ) : null}

      <section>
        <Card title="Leaderboard">
          <Leaderboard
            rows={view.scores.map((s) => ({ id: s.playerId, rank: s.rank, name: s.name, total: s.total }))}
            emptyText="No players in this round yet."
          />
        </Card>
      </section>

      <section>
        <Card title="Rosters">
          <p className="-mt-1 mb-3 text-[15px] text-fg-muted">Tap a player to see where their points came from.</p>
          <RosterList scores={view.scores} teamNames={view.teamNames} draftInProgress={draftInProgress} />
        </Card>
      </section>

      <section>
        <Card title="Draft board">
          <DraftBoard
            picks={view.picks}
            draftOrder={round.draftOrder}
            rosterSize={round.rosterSize}
            playerNames={playerNames}
            teamNames={view.teamNames}
          />
        </Card>
      </section>

      <section>
        <Card title="Adjustments">
          <AdjustmentList adjustments={view.adjustments} playerNames={playerNames} teamNames={view.teamNames} />
        </Card>
      </section>
    </main>
  );
}
