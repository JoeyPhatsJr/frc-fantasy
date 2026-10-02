'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { showLiveDraftPill } from '@/lib/nav';
import type { MyLiveDraft } from '@/lib/views/liveDrafts';

/** App-wide "Draft is live" pill, floating above the bottom bar (spec §5.5). */
export function LiveDraftPillView({ drafts, pathname }: { drafts: MyLiveDraft[]; pathname: string }) {
  if (drafts.length === 0 || !showLiveDraftPill(pathname)) return null;
  const first = drafts[0];
  const more = drafts.length - 1;
  return (
    <Link
      href={`/l/${encodeURIComponent(first.leagueSlug)}/r/${encodeURIComponent(first.roundId)}/draft`}
      className="fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex min-h-11 max-w-md items-center gap-2 rounded-full bg-accent px-4 font-semibold text-on-accent shadow-lg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      {first.phase === 'live' ? (
        <span aria-hidden="true" className="motion-safe:animate-pulse">●</span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">
        {first.phase === 'paused'
          ? `Draft paused — ${first.leagueName}`
          : first.myTurn
            ? `Your pick! — ${first.leagueName}`
            : `Draft is live — ${first.leagueName} · Join`}
      </span>
      {more > 0 ? <span className="shrink-0">+{more}</span> : null}
    </Link>
  );
}

export function LiveDraftPill({ drafts }: { drafts: MyLiveDraft[] }) {
  return <LiveDraftPillView drafts={drafts} pathname={usePathname()} />;
}
