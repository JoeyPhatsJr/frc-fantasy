import Link from 'next/link';
import type { MeLeague } from '@/lib/views/me';

/** "My leagues" rows (spec §4.6): shared by the Me tab and the Leagues tab. */
export function LeagueRows({ leagues }: { leagues: MeLeague[] }) {
  return (
    <ul className="-mx-2 divide-y divide-border">
      {leagues.map((l) => (
        <li key={l.slug}>
          <Link
            href={`/l/${l.slug}`}
            className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-fg/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            {l.anyLive ? (
              <span aria-label="Live" className="size-2.5 shrink-0 rounded-full bg-success ring-4 ring-success/25 motion-safe:animate-pulse" />
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-fg">{l.name}</span>
              {l.isCommissioner ? <span className="block text-sm font-semibold text-secondary">Commissioner</span> : null}
            </span>
            {l.error ? (
              <span className="shrink-0 text-sm text-fg-muted">Couldn&apos;t load</span>
            ) : (
              <span className="shrink-0 text-right tabular-nums">
                <span className="block font-display text-xl font-bold text-fg">{l.total}</span>
                <span className="block text-sm text-fg-muted">{l.rank ? `#${l.rank}` : '—'}</span>
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
