import { notFound, redirect } from 'next/navigation';
import { PrivateLeague } from '@/components/PrivateLeague';
import { leagueAccess } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { targetFromRows } from '@/lib/rounds/targetFor';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

/** The Draft tab: jump to the current round's draft (spec §5.1). */
export default async function DraftTabPage({ params }: Props) {
  const { slug } = await params;
  const access = await leagueAccess(slug);
  if (!access) notFound();
  if (!access.canView) return <PrivateLeague signedIn={access.user !== null} next={`/l/${slug}/draft`} />;
  const repo = getRepo();
  const rounds = await repo.listRounds(access.league.id);
  const picks = await repo.listPicksForRounds(rounds.map((r) => r.id));
  const target = targetFromRows(rounds, picks, new Date());
  if (target) redirect(`/l/${encodeURIComponent(slug)}/r/${target}/draft`);
  return (
    <main id="main" className="space-y-4 py-6 text-center">
      <h1 className="font-display text-[24px] font-bold text-fg">No drafts yet</h1>
      <p className="text-fg-muted">When the commissioner adds an event, its draft shows up here.</p>
    </main>
  );
}
