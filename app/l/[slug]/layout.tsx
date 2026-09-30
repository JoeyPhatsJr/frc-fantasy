import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { LeagueBar } from '@/components/LeagueBar';
import { TabBar } from '@/components/TabBar';
import { getRepo } from '@/lib/db';
import { localDate, roundStatus } from '@/lib/rounds/status';
import { targetRound } from '@/lib/rounds/target';

export const dynamic = 'force-dynamic';

type Props = { children: ReactNode; params: Promise<{ slug: string }> };

type Shell = { league: { slug: string; name: string }; anyLive: boolean; targetRoundId: string | null };

/** League name, live flag and the Round tab's target, from the database only (no TBA calls). */
async function loadShell(slug: string, now: Date): Promise<Shell | null> {
  const repo = getRepo();
  const league = await repo.getLeagueBySlug(slug);
  if (!league) return null;

  const rounds = await repo.listRounds(league.id);
  const picks = await repo.listPicksForRounds(rounds.map((r) => r.id));
  const statuses = rounds.map((round) => ({
    id: round.id,
    startDate: round.startDate,
    status: roundStatus(round, picks.filter((p) => p.roundId === round.id).length, now),
  }));

  return {
    // Only { slug, name } leaves this function; the admin token hash never does.
    league: { slug: league.slug, name: league.name },
    anyLive: statuses.some((r) => r.status === 'live'),
    targetRoundId: targetRound(statuses, localDate(now, rounds[0]?.timezone)),
  };
}

export default async function LeagueLayout({ children, params }: Props) {
  const { slug } = await params;

  let shell: Shell | null;
  try {
    shell = await loadShell(slug, new Date());
  } catch (err) {
    // A layout's errors skip this segment's error.tsx. Render the page bare instead: it hits the
    // same database, fails the same way, and shows the friendly "database is asleep" screen.
    console.error(err);
    return children;
  }
  if (!shell) notFound();

  return (
    <>
      <div className="mb-6">
        <LeagueBar slug={shell.league.slug} name={shell.league.name} anyLive={shell.anyLive} />
        <TabBar slug={shell.league.slug} targetRoundId={shell.targetRoundId} />
      </div>
      {children}
    </>
  );
}
