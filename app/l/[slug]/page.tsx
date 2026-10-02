import { notFound } from 'next/navigation';
import { AutoRefresh } from '@/components/AutoRefresh';
import { DateBlock } from '@/components/DateBlock';
import { EventBody } from '@/components/event/EventBody';
import { PrivateLeague } from '@/components/PrivateLeague';
import { EventList } from '@/components/standings/EventList';
import { SeasonBoard, seasonProgress } from '@/components/standings/SeasonBoard';
import { Button } from '@/components/ui/Button';
import { Row } from '@/components/ui/Row';
import { Section } from '@/components/ui/Section';
import { StatusStrip } from '@/components/ui/StatusStrip';
import { leagueAccess } from '@/lib/auth/roles';
import { scheduleFollowSync } from '@/lib/follow/sync';
import { formatDateRange, freshnessText } from '@/lib/format';
import { localDate, type RoundStatus } from '@/lib/rounds/status';
import { targetRound } from '@/lib/rounds/target';
import type { SeasonEventScore } from '@/lib/season/score';
import { loadLeaguePage, type LeaguePage as LeaguePageData } from '@/lib/views/league';
import type { RoundView } from '@/lib/views/round';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Props = { params: Promise<{ slug: string }> };

/** Before the draft (or the event) everyone is tied, so a rank there says nothing. */
const UNRANKED: ReadonlySet<RoundStatus> = new Set(['setup', 'drafting', 'upcoming']);

function adminHref(slug: string): string {
  return `/l/${encodeURIComponent(slug)}/admin`;
}

function NoEvents({ slug, isCommissioner }: { slug: string; isCommissioner: boolean }) {
  return (
    <div className="space-y-3 px-4 py-4">
      <p className="text-[15px] text-fg-muted">No events yet.</p>
      {isCommissioner ? <Button href={adminHref(slug)}>Add one in Admin</Button> : null}
    </div>
  );
}

/** Every event the season round's drafted teams play, once each, in date order. */
function seasonEvents(view: RoundView): SeasonEventScore[] {
  const byKey = new Map<string, SeasonEventScore>();
  for (const detail of Object.values(view.season ?? {})) {
    for (const e of detail.events) if (!byKey.has(e.eventKey)) byKey.set(e.eventKey, e);
  }
  return [...byKey.values()].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.eventKey.localeCompare(b.eventKey));
}

/** Event-by-event leagues (spec §6.3): progress strip, season leaderboard, events list. */
function EventStandings({ slug, page, meId, isCommissioner, now }: { slug: string; page: LeaguePageData; meId: string | null; isCommissioner: boolean; now: Date }) {
  const { standings, rounds } = page;
  return (
    <>
      {page.anyLive ? <AutoRefresh seconds={60} /> : null}
      <StatusStrip
        tone="neutral"
        title={seasonProgress(rounds)}
        detail={page.anyLive ? freshnessText(page.fetchedAt, page.stale, now) : undefined}
      />
      <Section label="Standings">
        {standings.length > 0 ? (
          <SeasonBoard
            standings={standings}
            rounds={rounds.map((v) => ({ id: v.round.id, eventName: v.round.eventName, status: v.status }))}
            meId={meId}
          />
        ) : (
          <div className="space-y-3 px-4 py-4">
            <p className="text-[15px] text-fg-muted">No players yet — share the invite code from Admin.</p>
            {isCommissioner ? <Button href={adminHref(slug)} variant="secondary">Go to Admin</Button> : null}
          </div>
        )}
      </Section>
      <Section label="Events">
        {rounds.length > 0 ? (
          <EventList
            slug={slug}
            rounds={rounds.map((v) => ({
              id: v.round.id,
              eventName: v.round.eventName,
              startDate: v.round.startDate,
              endDate: v.round.endDate,
              status: v.status,
              myRank: meId !== null && !UNRANKED.has(v.status) ? (v.scores.find((s) => s.playerId === meId)?.rank ?? null) : null,
            }))}
          />
        ) : (
          <NoEvents slug={slug} isCommissioner={isCommissioner} />
        )}
      </Section>
    </>
  );
}

/** Full-season leagues (spec §6.4): the current season round in the Event-tab layout, then its calendar. */
function SeasonStandings({ slug, page, meId, isCommissioner, now }: { slug: string; page: LeaguePageData; meId: string | null; isCommissioner: boolean; now: Date }) {
  const seasons = page.rounds.filter((v) => v.round.kind === 'season');
  const currentId = targetRound(
    seasons.map((v) => ({ id: v.round.id, startDate: v.round.startDate, status: v.status })),
    localDate(now, seasons[0]?.round.timezone),
  );
  const view = seasons.find((v) => v.round.id === currentId);
  if (!view) {
    return (
      <>
        <StatusStrip tone="neutral" title="No events yet" />
        <NoEvents slug={slug} isCommissioner={isCommissioner} />
      </>
    );
  }
  const events = seasonEvents(view);
  return (
    <>
      {view.status === 'live' ? <AutoRefresh seconds={60} /> : null}
      <EventBody
        slug={slug}
        view={view}
        now={now}
        meId={meId}
        playerNames={Object.fromEntries(page.standings.map((s) => [s.playerId, s.name]))}
        rounds={seasons.map((v) => ({ id: v.round.id, eventName: v.round.eventName, startDate: v.round.startDate }))}
      />
      {events.length > 0 ? (
        <Section label="Events this season">
          {events.map((e) => (
            <Row
              key={e.eventKey}
              leading={<DateBlock date={e.startDate} />}
              title={e.name}
              subtitle={formatDateRange(e.startDate, e.endDate)}
            />
          ))}
        </Section>
      ) : null}
    </>
  );
}

/** The Standings tab (spec §6.3, §6.4). The league header above it carries the name, tabs and ⋯ menu. */
export default async function LeaguePage({ params }: Props) {
  const { slug } = await params;
  const access = await leagueAccess(slug);
  if (!access) notFound();
  if (!access.canView) return <PrivateLeague signedIn={access.user !== null} next={`/l/${slug}`} />;

  const now = new Date();
  const page = await loadLeaguePage(slug, now);
  if (!page) notFound();
  // Spec §5.4: add followed teams' new events after this response is sent (never delays the page).
  scheduleFollowSync(access.league, now);

  const meId = access.player?.id ?? null;
  const props = { slug: page.league.slug, page, meId, isCommissioner: access.isCommissioner, now };

  return (
    <main id="main" className="space-y-6">
      {/* The league header (app/l/[slug]/layout.tsx) shows the name; this keeps a page heading for screen readers. */}
      <h1 className="sr-only">{page.league.name} standings</h1>
      {access.league.format === 'season' ? <SeasonStandings {...props} /> : <EventStandings {...props} />}
    </main>
  );
}
