import Link from 'next/link';
import type { ReactNode } from 'react';

export type LeagueBarProps = {
  slug: string;
  name: string;
  /** Shows the pulsing live dot. */
  anyLive: boolean;
  /** Optional compact back link, rendered before the name. */
  back?: ReactNode;
};

/**
 * The league's name at the top of every /l/[slug] page, server-rendered so it can show whether a
 * round is live. The name links back to the standings.
 */
export function LeagueBar({ slug, name, anyLive, back }: LeagueBarProps) {
  return (
    <div className="flex min-h-11 items-center gap-2">
      {back}
      <Link
        href={`/l/${slug}`}
        className="flex min-h-11 min-w-0 cursor-pointer items-center rounded-lg font-display text-[22px] font-bold leading-[26px] text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 truncate" title={name}>
          {name}
        </span>
      </Link>
      {anyLive ? (
        <span className="ml-auto flex shrink-0 items-center pl-2">
          <span
            data-live-dot
            aria-hidden="true"
            className="size-2.5 rounded-full bg-success ring-4 ring-success/25 motion-safe:animate-pulse"
          />
          <span className="sr-only">A round is live</span>
        </span>
      ) : null}
    </div>
  );
}
