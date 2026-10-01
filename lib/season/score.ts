import type { RoundRow } from '@/lib/db/types';
import { addDays, cacheWindowFor, DEFAULT_WINDOW_MS, localDate, type RoundTiming } from '@/lib/rounds/status';
import { getEventScores } from '@/lib/scores/eventScores';
import type { EventScores, Line, TeamScore } from '@/lib/scoring/types';
import { createFetchBudget, type FetchBudget, SEASON_BUDGET } from '@/lib/season/budget';
import { isOfficialEvent, SEASON_TIMEZONE } from '@/lib/season/calendar';
import { getTba } from '@/lib/tba/client';
import type { EventSimple } from '@/lib/tba/types';

export type SeasonEventScore = {
  eventKey: string;
  name: string;
  startDate: string;
  endDate: string;
  total: number;
  lines: Line[];
  stale: boolean;
};
export type SeasonTeamDetail = {
  teamKey: string;
  total: number;
  events: SeasonEventScore[];
  next: { eventKey: string; name: string; startDate: string } | null;
};
export type SeasonScores = {
  teams: Map<string, TeamScore>;
  detail: Record<string, SeasonTeamDetail>;
  fetchedAt: string | null;
  stale: boolean;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_ONLY = Number.POSITIVE_INFINITY; // getTba/getEventScores treat any cached row as fresh
const EMPTY: EventScores = { teams: new Map(), qualsComplete: false, rpMethod: 'none' };

type Scored = { scores: EventScores; stale: boolean; fetchedAt: string | null };

/**
 * A season round's score for each drafted team (spec §5.5): the sum over the team's official events
 * of that year, each scored with the round's config through the event_scores cache.
 */
export async function scoreSeasonRound(
  round: RoundRow,
  teamKeys: string[],
  now: Date,
  budget: FetchBudget = createFetchBudget(SEASON_BUDGET),
): Promise<SeasonScores> {
  const year = round.seasonYear!;
  const today = localDate(now, SEASON_TIMEZONE);
  const times: string[] = [];
  let stale = false;
  const note = (r: { stale: boolean; fetchedAt: string | null }) => {
    stale ||= r.stale;
    if (r.fetchedAt) times.push(r.fetchedAt);
  };

  // 1. Each drafted team's official events, in date order.
  const lists = await Promise.all(
    teamKeys.map((key) => {
      const path = `/team/${key}/events/${year}/simple`;
      return budget.run(
        () => getTba<EventSimple[]>(path, { windowMs: DEFAULT_WINDOW_MS }),
        async () => ({ ...(await getTba<EventSimple[]>(path, { windowMs: CACHE_ONLY })), stale: true }),
      );
    }),
  );
  const eventsByTeam = new Map<string, EventSimple[]>();
  const toScore = new Map<string, EventSimple>();
  lists.forEach((list, i) => {
    note(list);
    const official = (Array.isArray(list.data) ? list.data : [])
      .filter((e) => e && isOfficialEvent(e) && DATE_RE.test(e.start_date ?? '') && DATE_RE.test(e.end_date ?? ''))
      .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.key.localeCompare(b.key));
    eventsByTeam.set(teamKeys[i], official);
    // Same one-day lead as v1's eventPhase: an event is scored from the day before it starts.
    for (const e of official) if (e.start_date <= addDays(today, 1)) toScore.set(e.key, e);
  });

  // 2. Score each event once, within the budget.
  const scored = new Map<string, Scored>();
  await Promise.all(
    [...toScore.values()].map(async (e) => {
      const timing: RoundTiming = {
        startDate: e.start_date,
        endDate: e.end_date,
        timezone: SEASON_TIMEZONE, // Event_Simple has no timezone (spec §5.5)
        finalizedAt: round.finalizedAt,
      };
      let result: Scored;
      try {
        result = await budget.run(
          () => getEventScores(e.key, round.scoring, cacheWindowFor(timing, now), { now }),
          async () => ({ ...(await getEventScores(e.key, round.scoring, CACHE_ONLY, { now })), stale: true }),
        );
      } catch (err) {
        console.error(`Season scoring: ${e.key} failed`, err);
        result = { scores: EMPTY, stale: true, fetchedAt: null };
      }
      note(result);
      scored.set(e.key, result);
    }),
  );

  // 3. Per team: per-event rows, a flat TeamScore for scoreRound, and the next event.
  const teams = new Map<string, TeamScore>();
  const detail: Record<string, SeasonTeamDetail> = {};
  for (const teamKey of teamKeys) {
    const events = eventsByTeam.get(teamKey) ?? [];
    const rows: SeasonEventScore[] = events
      .filter((e) => scored.has(e.key))
      .map((e) => {
        const s = scored.get(e.key)!;
        const team = s.scores.teams.get(teamKey);
        return {
          eventKey: e.key,
          name: e.name,
          startDate: e.start_date,
          endDate: e.end_date,
          total: team?.total ?? 0,
          lines: team?.lines ?? [],
          stale: s.stale,
        };
      });
    const upcoming = events.find((e) => e.start_date > today);
    const total = rows.reduce((sum, r) => sum + r.total, 0);
    teams.set(teamKey, { teamKey, total, lines: rows.flatMap((r) => r.lines) });
    detail[teamKey] = {
      teamKey,
      total,
      events: rows,
      next: upcoming ? { eventKey: upcoming.key, name: upcoming.name, startDate: upcoming.start_date } : null,
    };
  }

  return { teams, detail, fetchedAt: times.length > 0 ? times.sort()[0] : null, stale };
}
