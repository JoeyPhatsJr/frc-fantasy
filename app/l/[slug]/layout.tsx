import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { LeagueHeader } from '@/components/shell/LeagueHeader';
import { leagueAccess } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import type { LeagueFormat } from '@/lib/db/types';
import { statusesFromRows, targetFromRows } from '@/lib/rounds/targetFor';
import { listMyLeagues } from '@/lib/views/memberships';

export const dynamic = 'force-dynamic';

type Props = { children: ReactNode; params: Promise<{ slug: string }> };

type Shell = {
  canView: boolean;
  league: { slug: string; name: string; format: LeagueFormat };
  anyLive: boolean;
  targetRoundId: string | null;
  isCommissioner: boolean;
  isMember: boolean;
  myName: string | null;
  myLeagues: { slug: string; name: string }[];
};

/** The signed-in user's other leagues, for the Switch chip. A failure only hides the chip. */
async function otherLeagues(userId: string, leagueId: string): Promise<{ slug: string; name: string }[]> {
  try {
    const mine = await listMyLeagues(userId);
    return mine.filter((m) => m.league.id !== leagueId).map((m) => ({ slug: m.league.slug, name: m.league.name }));
  } catch (err) {
    console.error(err);
    return [];
  }
}

/** League name, live flag, tab targets and the viewer's menu data, from the database only (no TBA calls). */
async function loadShell(slug: string, now: Date): Promise<Shell | null> {
  const access = await leagueAccess(slug);
  if (!access) return null;
  const { league } = access;
  // Non-members get no league data at all: the page renders the private card instead.
  if (!access.canView) {
    return {
      canView: false,
      league: { slug: league.slug, name: '', format: league.format },
      anyLive: false,
      targetRoundId: null,
      isCommissioner: false,
      isMember: false,
      myName: null,
      myLeagues: [],
    };
  }
  const repo = getRepo();
  const rounds = await repo.listRounds(league.id);
  const picks = await repo.listPicksForRounds(rounds.map((r) => r.id));

  return {
    canView: true,
    // Only { slug, name, format } leaves this function.
    league: { slug: league.slug, name: league.name, format: league.format },
    anyLive: statusesFromRows(rounds, picks, now).some((r) => r.status === 'live'),
    targetRoundId: targetFromRows(rounds, picks, now),
    isCommissioner: access.isCommissioner,
    isMember: access.player !== null,
    myName: access.player?.name ?? null,
    myLeagues: access.user ? await otherLeagues(access.user.id, league.id) : [],
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
      <LeagueHeader
        slug={shell.league.slug}
        name={shell.league.name}
        format={shell.league.format}
        isCommissioner={shell.isCommissioner}
        isMember={shell.isMember}
        myName={shell.myName}
        targetRoundId={shell.targetRoundId}
        anyLive={shell.anyLive}
        myLeagues={shell.myLeagues}
      />
      {children}
    </>
  );
}
