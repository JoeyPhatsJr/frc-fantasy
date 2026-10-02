import { Row } from '@/components/ui/Row';
import type { HomeLeague } from '@/lib/views/home';

/**
 * One row per league (spec §6.1): status line under the name, rank on the right. Callers wrap it in a Section.
 * The Commissioner badge leads the status line, so a long league name is what gets cut off, never the badge.
 */
export function LeagueRows({ leagues }: { leagues: HomeLeague[] }) {
  return (
    <>
      {leagues.map((l) => (
        <Row
          key={l.slug}
          href={l.error ? undefined : `/l/${l.slug}`}
          title={l.name}
          subtitle={
            <>
              {l.isCommissioner ? (
                <span className="mr-2 inline-block rounded-[4px] bg-secondary px-1.5 align-middle text-[11px] font-bold uppercase leading-5 tracking-[.1em] text-on-secondary">
                  Commissioner
                </span>
              ) : null}
              {l.error ? "Couldn't load" : l.line}
            </>
          }
          trailing={
            l.error ? null : <span className="font-display text-[22px] font-bold tabular-nums text-fg">{l.rank ? `#${l.rank}` : '—'}</span>
          }
        />
      ))}
    </>
  );
}
