import Link from 'next/link';
import { ArrowRight } from '@/components/ui/icons';
import type { LiveDraft } from '@/lib/draft/liveBanner';

export function LiveDraftBanner({ slug, drafts }: { slug: string; drafts: LiveDraft[] }) {
  if (drafts.length === 0) return null;
  return (
    <div className="space-y-2">
      {drafts.map((d) => (
        <Link
          key={d.roundId}
          href={`/l/${slug}/r/${d.roundId}/draft`}
          className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-card bg-accent px-4 py-3 text-on-accent hover:bg-accent-strong focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0">
            <span className="block font-semibold">Draft is live — join</span>
            <span className="block truncate text-[13px]">
              {d.eventName}
              {d.phase === 'paused' ? ' · paused' : ''}
            </span>
          </span>
          <ArrowRight className="size-5 shrink-0" />
        </Link>
      ))}
    </div>
  );
}
