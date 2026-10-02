import { notFound } from 'next/navigation';
import { AutoRefresh } from '@/components/AutoRefresh';
import { EventBody } from '@/components/event/EventBody';
import { PrivateLeague } from '@/components/PrivateLeague';
import { Button } from '@/components/ui/Button';
import { leagueAccess } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { loadRoundPage } from '@/lib/views/round';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Props = { params: Promise<{ slug: string; roundId: string }> };

/** The Event tab when the league has no rounds yet (the tab links to /r/none). */
function NoEvents({ slug, isCommissioner }: { slug: string; isCommissioner: boolean }) {
  return (
    <main id="main" className="space-y-4 py-6 text-center">
      <h1 className="font-display text-[24px] font-bold text-fg">No events yet</h1>
      <p className="text-fg-muted">When the commissioner adds an event, it shows up here.</p>
      {isCommissioner ? <Button href={`/l/${encodeURIComponent(slug)}/admin`}>Add one in Admin</Button> : null}
    </main>
  );
}

/** The Event tab (spec §6.5). The league header above it carries the league name and tabs. */
export default async function RoundPage({ params }: Props) {
  const { slug, roundId } = await params;
  const access = await leagueAccess(slug);
  if (!access) notFound();
  if (!access.canView) return <PrivateLeague signedIn={access.user !== null} next={`/l/${slug}/r/${roundId}`} />;
  if (roundId === 'none') return <NoEvents slug={slug} isCommissioner={access.isCommissioner} />;

  const now = new Date();
  const [page, allRounds] = await Promise.all([loadRoundPage(slug, roundId, now), getRepo().listRounds(access.league.id)]);
  if (!page) notFound();

  return (
    <main id="main" className="space-y-6">
      <AutoRefresh seconds={60} />
      <h1 className="sr-only">{page.view.round.eventName}</h1>
      <EventBody
        slug={slug}
        view={page.view}
        now={now}
        meId={access.player?.id ?? null}
        playerNames={page.playerNames}
        rounds={allRounds.map((r) => ({ id: r.id, eventName: r.eventName, startDate: r.startDate }))}
      />
    </main>
  );
}
