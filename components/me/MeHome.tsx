import Link from 'next/link';
import { InviteCodeBox } from '@/components/InviteCodeBox';
import { BumperPlate } from '@/components/ui/BumperPlate';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { teamLabel } from '@/lib/teams';
import type { MeLeague, MePage } from '@/lib/views/me';

export function MeHome({ page }: { page: MePage }) {
  const { leagues, teams, season } = page;
  if (leagues.length === 0) {
    return (
      <main id="main" className="space-y-6">
        <h1 className="font-display text-[28px] font-bold leading-8 text-fg">Welcome!</h1>
        <Card className="space-y-4">
          <p className="text-[15px] text-fg-muted">You&apos;re not in a league yet.</p>
          <Button href="/leagues/new">Create a league</Button>
          <InviteCodeBox />
        </Card>
      </main>
    );
  }
  const live = teams.some((t) => t.status === 'live');
  return (
    <main id="main" className="space-y-6">
      <h1 className="sr-only">Me</h1>
      {teams.length > 0 ? (
        <Card title={live ? 'Live now' : 'Up next'} className="space-y-2">
          <ul className="divide-y divide-border">
            {teams.map((t, i) => (
              <li key={`${t.leagueName}:${t.teamKey}`} className="flex min-h-14 items-center gap-3 py-2">
                <BumperPlate number={teamLabel(t.teamKey)} side={i % 2 === 0 ? 'blue' : 'red'} />
                <span className="min-w-0">
                  <span className="block font-semibold text-fg">{t.label}</span>
                  <span className="block truncate text-sm text-fg-muted">
                    {t.leagueName} · {t.eventName}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card title="My leagues">
        <LegacyLeagueRows leagues={leagues} />
      </Card>
      <Card title="My season" className="space-y-2">
        <p className="font-display text-[32px] font-bold tabular-nums text-fg">{season.total}</p>
        <p className="text-[15px] text-fg-muted">
          Best pick:{' '}
          {season.bestPick
            ? `${teamLabel(season.bestPick.teamKey)} at ${season.bestPick.eventName} · +${season.bestPick.points}`
            : '—'}
        </p>
        <p className="text-[15px] text-fg-muted">Average finish: {season.averageFinish ?? '—'}</p>
      </Card>
    </main>
  );
}

// Task 9: LeagueRows now takes HomeLeague[]; MeHome is dead code deleted in Task 17, so it keeps its own copy of the old rows.
function LegacyLeagueRows({ leagues }: { leagues: MeLeague[] }) {
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
