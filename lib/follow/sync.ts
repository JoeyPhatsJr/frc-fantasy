import { after } from 'next/server';
import { getRepo } from '@/lib/db';
import type { LeagueRow, RoundRow } from '@/lib/db/types';
import { pickFollowEvents } from '@/lib/follow/filter';
import { DEFAULT_WINDOW_MS, localDate } from '@/lib/rounds/status';
import { getTba } from '@/lib/tba/client';
import type { EventSimple, TbaEvent } from '@/lib/tba/types';

const EASTERN = 'America/New_York';

/**
 * Creates rounds for the events a league's followed teams attend (spec §5.4). Safe to run
 * concurrently: rounds are inserted with ON CONFLICT DO NOTHING. A TBA failure changes nothing.
 */
export async function syncFollowedEvents(league: LeagueRow, now: Date): Promise<{ ok: boolean; added: RoundRow[] }> {
  if (league.format !== 'event') return { ok: true, added: [] };
  const repo = getRepo();
  const follows = await repo.listFollows(league.id);
  if (follows.length === 0) {
    await repo.updateLeague(league.id, { followsSyncedAt: now.toISOString() });
    return { ok: true, added: [] };
  }

  const today = localDate(now, EASTERN);
  const year = Number(today.slice(0, 4));
  const lists = await Promise.all(
    follows.map((n) => getTba<EventSimple[]>(`/team/frc${n}/events/${year}/simple`, { windowMs: DEFAULT_WINDOW_MS })),
  );
  if (lists.some((l) => l.stale)) {
    console.error(`Follow sync for ${league.slug}: TBA unavailable, trying again later`);
    return { ok: false, added: [] };
  }

  const [rounds, skipped, players] = await Promise.all([
    repo.listRounds(league.id),
    repo.listSkippedEvents(league.id),
    repo.listPlayers(league.id),
  ]);
  const events = pickFollowEvents(
    lists.flatMap((l) => (Array.isArray(l.data) ? l.data : [])),
    {
      today,
      existing: new Set(rounds.map((r) => r.eventKey).filter((k): k is string => k !== null)),
      skipped: new Set(skipped),
    },
  );

  // Draft order and roster size come from the league's most recently *created* round (not the latest by date).
  const template = [...rounds].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const linked = new Set(players.filter((p) => p.userId !== null).map((p) => p.id));
  const draftOrder = template ? template.draftOrder.filter((id) => linked.has(id)) : [];
  const rosterSize = template ? Math.min(template.rosterSize, 10) : 4;

  const added: RoundRow[] = [];
  for (const e of events) {
    // Event_Simple has no timezone; one small look-up per *new* event gets it (fallback Eastern).
    const full = await getTba<TbaEvent>(`/event/${e.key}`, { windowMs: DEFAULT_WINDOW_MS });
    const round = await repo.createRoundIfAbsent({
      leagueId: league.id,
      kind: 'tba',
      eventKey: e.key,
      eventName: e.name.slice(0, 200),
      startDate: e.start_date,
      endDate: e.end_date,
      timezone: full.data?.timezone || EASTERN,
      scoring: structuredClone(league.defaultScoring),
      autoAdded: true,
      rosterSize,
      draftOrder,
    });
    if (round) added.push(round);
  }
  await repo.updateLeague(league.id, { followsSyncedAt: now.toISOString() });
  return { ok: true, added };
}

export const FOLLOW_SYNC_EVERY_MS = 10 * 60_000;

/** Spec §5.4 "on visit": only event leagues, and only when the last sync is missing or 10+ minutes old. */
export function shouldSyncOnVisit(league: LeagueRow, now: Date): boolean {
  if (league.format !== 'event') return false;
  if (!league.followsSyncedAt) return true;
  return now.getTime() - Date.parse(league.followsSyncedAt) >= FOLLOW_SYNC_EVERY_MS;
}

/** Runs the sync after the response is sent (Next.js after()), so a page view never waits on TBA. */
export function scheduleFollowSync(league: LeagueRow, now: Date = new Date()): void {
  if (!shouldSyncOnVisit(league, now)) return;
  try {
    after(async () => {
      try {
        await syncFollowedEvents(league, now);
      } catch (err) {
        console.error(`Follow sync for ${league.slug} failed`, err);
      }
    });
  } catch (err) {
    // after() throws outside a request scope; a page view must never fail because of the sync.
    console.error(`Follow sync for ${league.slug} not scheduled`, err);
  }
}

/** Daily cron job (spec §5.4): every league that follows a team, until the time budget runs out. */
export const followSyncJob = {
  name: 'follow-sync',
  async run(now: Date, deadline: number): Promise<void> {
    for (const league of await getRepo().listLeaguesWithFollows()) {
      if (Date.now() >= deadline) break;
      try {
        await syncFollowedEvents(league, now);
      } catch (err) {
        console.error(`Follow sync for ${league.slug} failed`, err);
      }
    }
  },
};
