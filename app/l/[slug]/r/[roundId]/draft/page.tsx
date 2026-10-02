import { notFound } from 'next/navigation';
import { DraftRoom } from '@/components/draft/DraftRoom';
import { DraftBoard } from '@/components/DraftBoard';
import { PrivateLeague } from '@/components/PrivateLeague';
import { StatusStrip } from '@/components/ui/StatusStrip';
import { isUuid } from '@/lib/api/http';
import { leagueAccess } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { loadRoundPage } from '@/lib/views/round';

export const dynamic = 'force-dynamic';
// Hand-entered rounds load the round view, which can wait on TBA (same as the Event tab).
export const maxDuration = 30;

type Props = { params: Promise<{ slug: string; roundId: string }> };

/** The Draft tab (UX §6.6). The league header above it carries the tabs, so there is no back link. */
export default async function DraftRoomPage({ params }: Props) {
  const { slug, roundId } = await params;
  // Same gate as the round page: members-only leagues show SP1's private card and load nothing else.
  const access = await leagueAccess(slug);
  if (!access) notFound();
  if (!access.canView) {
    return <PrivateLeague signedIn={access.user !== null} next={`/l/${slug}/r/${roundId}/draft`} />;
  }
  if (!isUuid(roundId)) notFound();
  const round = await getRepo().getRound(roundId);
  if (!round || round.leagueId !== access.league.id) notFound();

  // The commissioner types the picks in (round admin): show the board as it fills.
  if (round.draftMode !== 'live') {
    const page = await loadRoundPage(slug, round.id, new Date());
    if (!page) notFound();
    const { picks, teamNames } = page.view;
    const total = round.draftOrder.length * round.rosterSize;
    const done = total > 0 && picks.length >= total;
    return (
      <main id="main" className="space-y-4">
        <h1 className="sr-only">{round.eventName} draft</h1>
        <StatusStrip
          tone={done ? 'final' : 'neutral'}
          title={done ? 'Draft complete' : 'The commissioner enters picks for this event'}
          detail={`${picks.length} of ${total} picks`}
        />
        <DraftBoard
          picks={picks}
          draftOrder={round.draftOrder}
          rosterSize={round.rosterSize}
          playerNames={page.playerNames}
          teamNames={teamNames}
        />
      </main>
    );
  }

  return (
    <main id="main" className="space-y-3">
      <h1 className="sr-only">{round.eventName} draft</h1>
      <DraftRoom slug={slug} roundId={round.id} eventName={round.eventName} />
    </main>
  );
}
