import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DraftRoom } from '@/components/draft/DraftRoom';
import { PrivateLeague } from '@/components/PrivateLeague';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChevronLeft } from '@/components/ui/icons';
import { isUuid } from '@/lib/api/http';
import { leagueAccess } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string; roundId: string }> };

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

  const back = (
    <Link
      href={`/l/${slug}/r/${round.id}`}
      className="-ml-2 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg pr-3 pl-1 text-[15px] font-semibold text-primary hover:bg-surface-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronLeft className="size-5 shrink-0" />
      {round.eventName}
    </Link>
  );

  if (round.draftMode !== 'live') {
    return (
      <main id="main" className="space-y-4">
        {back}
        <Card title="No live draft for this round">
          <p className="text-[15px] text-fg">The commissioner enters this round&apos;s picks.</p>
          <Button href={`/l/${slug}/r/${round.id}`} variant="secondary" className="mt-4">
            See the draft board
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <main id="main" className="space-y-3">
      {back}
      <h1 className="font-display text-[28px] font-bold leading-[30px] text-fg">{round.eventName} draft</h1>
      <DraftRoom slug={slug} roundId={round.id} eventName={round.eventName} />
    </main>
  );
}
