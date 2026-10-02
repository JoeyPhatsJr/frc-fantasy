'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LeagueMenu } from '@/components/shell/LeagueMenu';
import { LeagueSwitcher } from '@/components/shell/LeagueSwitcher';
import { BandTabs } from '@/components/ui/Tabs';
import type { LeagueFormat } from '@/lib/db/types';
import { LEAGUE_TAB_LABEL, leagueTab, leagueTabHref, leagueTabs } from '@/lib/nav';

export type LeagueHeaderProps = {
  slug: string;
  name: string;
  format: LeagueFormat;
  isCommissioner: boolean;
  /** Signed-in member of this league (gets ⋯ menu); false for signed-out viewers and watchers. */
  isMember: boolean;
  /** This member's display name in this league (for the rename field); null when not a member. */
  myName: string | null;
  targetRoundId: string | null;
  anyLive: boolean;
  /** Other leagues of the signed-in user, for the switcher; [] hides the chip. */
  myLeagues: { slug: string; name: string }[];
};

/**
 * The league's part of the dark band (spec §5.3): name, live dot, Commissioner label, Switch ▾ and
 * ⋯, then the league tabs. It bleeds to the column edges under the sticky AppHeader (the root content
 * wrapper has px-4 py-6). On wide screens a border-image outset paints the band out to the window
 * edges: that is ink overflow only, so it adds no horizontal scroll and (unlike clip-path) doesn't clip
 * the fixed-position sheets the ⋯ menu and Switch chip open.
 */
export function LeagueHeaderView(p: LeagueHeaderProps & { pathname: string }) {
  const items = leagueTabs(p.format, p.isCommissioner).map((t) => ({
    key: t,
    label: LEAGUE_TAB_LABEL[t],
    href: leagueTabHref(t, p.slug, p.targetRoundId),
  }));
  return (
    <div className="-mx-4 -mt-6 mb-4 bg-band px-4 pt-3 text-on-band full-bleed-band">
      <div className="flex items-center gap-2">
        {/* The Commissioner label sits under the name so a long name keeps its width at 360px. */}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href={`/l/${encodeURIComponent(p.slug)}`}
              title={p.name}
              className="min-h-11 min-w-0 cursor-pointer truncate rounded-lg py-2 font-display text-[22px] font-bold uppercase leading-7 tracking-[.04em] text-on-band focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              {p.name}
            </Link>
            {p.anyLive ? (
              <span className="flex shrink-0 items-center">
                {/* band-live, not success: light-theme success (#127a3a) is too dim on the dark band. */}
                <span
                  data-live-dot
                  aria-hidden="true"
                  className="size-2.5 rounded-full bg-band-live ring-4 ring-band-live/25 motion-safe:animate-pulse"
                />
                <span className="sr-only">A round is live</span>
              </span>
            ) : null}
          </div>
          {p.isCommissioner ? (
            <span className="-mt-1 mb-1 inline-block rounded-[4px] bg-secondary px-1.5 text-[11px] font-bold uppercase leading-5 tracking-[.1em] text-on-secondary">
              Commissioner
            </span>
          ) : null}
        </div>
        {p.isMember && p.myLeagues.length > 0 ? <LeagueSwitcher leagues={p.myLeagues} /> : null}
        {p.isMember ? <LeagueMenu slug={p.slug} leagueName={p.name} name={p.myName ?? ''} /> : null}
      </div>
      <BandTabs label="League" active={leagueTab(p.pathname, p.slug)} items={items} />
    </div>
  );
}

export function LeagueHeader(p: LeagueHeaderProps) {
  const pathname = usePathname();
  return <LeagueHeaderView {...p} pathname={pathname ?? `/l/${p.slug}`} />;
}
