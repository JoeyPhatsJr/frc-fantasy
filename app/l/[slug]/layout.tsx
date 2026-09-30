import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { LeagueBar } from '@/components/LeagueBar';
import { TabBar } from '@/components/TabBar';
import { leagueAccess } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { localDate, roundStatus } from '@/lib/rounds/status';
import { targetRound } from '@/lib/rounds/target';

export const dynamic = 'force-dynamic';

type Props = { children: ReactNode; params: Promise<{ slug: string }> };

type Shell = {
  canView: boolean;
  league: { slug: string; name: string };
  anyLive: boolean;
  targetRoundId: string | null;
  isCommissioner: boolean;
};

/** League name, live flag and the Round tab's target, from the database only (no TBA calls). */
async function loadShell(slug: string, now: Date): Promise<Shell | null> {
  const access = await leagueAccess(slug);
  if (!access) return null;
  const { league } = access;
  // Non-members get no league data at all: the page renders the private card instead.
  if (!access.canView) {
    return { canView: false, league: { slug: league.slug, name: '' }, anyLive: false, targetRoundId: null, isCommissioner: false };
  }
  const repo = getRepo();
  const rounds = await repo.listRounds(league.id);
  const picks = await repo.listPicksForRounds(rounds.map((r) => r.id));
  const statuses = rounds.map((round) => ({
    id: round.id,
    startDate: round.startDate,
    status: roundStatus(round, picks.filter((p) => p.roundId === round.id).length, now),
  }));

  return {
    canView: true,
    // Only { slug, name } leaves this function.
    league: { slug: league.slug, name: league.name },
    anyLive: statuses.some((r) => r.status === 'live'),
    targetRoundId: targetRound(statuses, localDate(now, rounds[0]?.timezone)),
    isCommissioner: access.isCommissioner,
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
  if (!shell.canView) return children;

  return (
    <>
      <div className="mb-6">
        <LeagueBar slug={shell.league.slug} name={shell.league.name} anyLive={shell.anyLive} isCommissioner={shell.isCommissioner} />
        <TabBar slug={shell.league.slug} targetRoundId={shell.targetRoundId} showAdmin={shell.isCommissioner} />
      </div>
      {children}
    </>
  );
}
