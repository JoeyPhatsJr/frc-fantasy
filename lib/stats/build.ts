import type { Repo } from '@/lib/db/repo';
import { addDays, localDate, MINUTE_MS } from '@/lib/rounds/status';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { getEventScores } from '@/lib/scores/eventScores';
import { aggregateTeamSeason, summarizeEvent, type TeamEventSummary } from '@/lib/stats/summarize';
import { cleanEventData } from '@/lib/tba/clean';
import { getTba, type TbaDeps } from '@/lib/tba/client';
import { eventPaths, loadEventData } from '@/lib/tba/event';
import type { TbaEvent } from '@/lib/tba/types';

/** Past seasons are final: once a path is cached it is never fetched again (spec §6.2). */
export const NEVER_REFETCH_MS = Number.POSITIVE_INFINITY;
const DAY_MS = 24 * 60 * MINUTE_MS;
/**
 * The daily cron's window for current-season events that ended more than 8 days ago. Those are
 * final, and the cron refreshed them daily while they were recent, so it reads them from tba_cache.
 */
export const CRON_FINAL_WINDOW_MS = 30 * DAY_MS;
/** How many recent events the cron loads at once (each is 6 parallel TBA requests). */
const RECENT_EVENT_CONCURRENCY = 4;
const PRESEASON = 100;

export type StatsDeps = {
  repo: Repo;
  now: Date;
  /** Passed to getTba: the build script throttles fetch here; tests fake it. */
  tba?: Partial<TbaDeps>;
  /** Wall clock for time budgets (ms). Defaults to Date.now. */
  clock?: () => number;
};

const tbaDeps = (deps: StatsDeps): Partial<TbaDeps> => ({ store: deps.repo, ...deps.tba });

export function statsWindowMs(
  event: { key: string; end_date: string; timezone?: string | null },
  now: Date,
  finishedWindowMs: number = DAY_MS,
): number {
  const today = localDate(now, event.timezone ?? null);
  if (Number(event.key.slice(0, 4)) < Number(today.slice(0, 4))) return NEVER_REFETCH_MS;
  if (event.end_date < addDays(today, -8)) return finishedWindowMs;
  return 10 * MINUTE_MS;
}

/** Spec §6.1: every event except preseason. Offseason counts when it has played quals (summarizeEvent checks). */
export function countsForStats(event: TbaEvent): boolean {
  return event.event_type !== PRESEASON;
}

const isEvent = (e: unknown): e is TbaEvent =>
  typeof e === 'object' && e !== null && typeof (e as TbaEvent).key === 'string' &&
  typeof (e as TbaEvent).end_date === 'string' && typeof (e as TbaEvent).start_date === 'string';

export async function listSeasonEvents(season: number, deps: StatsDeps): Promise<TbaEvent[]> {
  const thisYear = Number(localDate(deps.now, 'America/New_York').slice(0, 4));
  const res = await getTba<unknown[]>(
    `/events/${season}/simple`,
    { windowMs: season < thisYear ? NEVER_REFETCH_MS : 10 * MINUTE_MS },
    tbaDeps(deps),
  );
  const events = Array.isArray(res.data) ? res.data.filter(isEvent) : [];
  return events
    .filter(countsForStats)
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.key.localeCompare(b.key));
}

/** Scores the event with DEFAULT_SCORING through event_scores, then summarizes it per team. */
export async function loadEventSummaries(
  event: TbaEvent,
  deps: StatsDeps,
  windowMs: number = statsWindowMs(event, deps.now),
): Promise<TeamEventSummary[]> {
  const scored = await getEventScores(event.key, DEFAULT_SCORING, windowMs, {
    now: deps.now,
    repo: deps.repo,
    tba: deps.tba,
  });
  // getEventScores just refreshed these paths, so this reads tba_cache only.
  const loaded = await loadEventData(event.key, { windowMs }, tbaDeps(deps));
  return summarizeEvent(event, cleanEventData(loaded.data), scored.scores);
}

/**
 * Builds every team_stats row for one season (scripts/build-team-stats.ts). Resumable: each TBA
 * response is saved to tba_cache as it arrives, and past seasons are never refetched, so a rerun
 * after an interruption reads the saved rows at database speed.
 */
export async function buildSeasonStats(
  season: number,
  deps: StatsDeps,
  opts: { log?: (line: string) => void } = {},
): Promise<{ events: number; teams: number; skipped: string[] }> {
  const log = opts.log ?? (() => {});
  const events = await listSeasonEvents(season, deps);
  const all: TeamEventSummary[] = [];
  const skipped: string[] = [];

  for (const [i, event] of events.entries()) {
    const summaries = await loadEventSummaries(event, deps);
    const counted = summaries.filter((s) => s.playedQuals > 0).length;
    if (counted === 0) skipped.push(event.key);
    all.push(...summaries);
    log(`[${i + 1}/${events.length}] ${event.key}  ${counted} teams`);
  }

  const byTeam = new Map<string, TeamEventSummary[]>();
  for (const s of all) byTeam.set(s.teamKey, [...(byTeam.get(s.teamKey) ?? []), s]);
  const updatedAt = deps.now.toISOString();
  // A team seen only through an awards-only summary played no counted event: no row.
  const rows = [...byTeam]
    .map(([teamKey, list]) => aggregateTeamSeason(teamKey, season, list, updatedAt))
    .filter((r) => r.eventsPlayed > 0);
  await deps.repo.upsertTeamStats(rows);
  return { events: events.length, teams: rows.length, skipped };
}

export async function teamSeasonEvents(teamKey: string, season: number, deps: StatsDeps): Promise<TbaEvent[]> {
  const res = await getTba<unknown[]>(`/team/${teamKey}/events/${season}/simple`, { windowMs: 10 * MINUTE_MS }, tbaDeps(deps));
  return (Array.isArray(res.data) ? res.data.filter(isEvent) : []).filter(countsForStats);
}

/**
 * Events ordered stalest first: by the oldest fetch among their six tba_cache paths, with a
 * never-cached path counting as oldest. One metadata query, no bodies.
 */
async function stalestFirst(events: TbaEvent[], repo: Repo): Promise<TbaEvent[]> {
  const pathsOf = (e: TbaEvent) => Object.values(eventPaths(e.key));
  const fetched = new Map((await repo.getCacheMeta(events.flatMap(pathsOf))).map((m) => [m.path, m.fetchedAt]));
  const oldestFetch = (e: TbaEvent) => pathsOf(e).map((p) => fetched.get(p) ?? '').sort()[0] ?? '';
  const age = new Map(events.map((e) => [e.key, oldestFetch(e)]));
  return [...events].sort((a, b) => age.get(a.key)!.localeCompare(age.get(b.key)!) || a.key.localeCompare(b.key));
}

/** Runs `fn` over `items` in order, at most `limit` at a time, starting no new item once `stop()`. True when all ran. */
async function eachLimited<T>(items: T[], limit: number, stop: () => boolean, fn: (item: T) => Promise<void>): Promise<boolean> {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !stop()) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return next >= items.length;
}

/**
 * The daily cron's team_stats job (spec §6.2): re-score current-season events with any day in
 * [today − 8, today], then rebuild the season row of every team at them. Stops at `deadline`.
 * Both phases resume: recent events load stalest first (a few at a time), so a run cut short
 * starts the next one with the events it missed; teams are taken least-recently-updated first.
 */
export async function refreshRecentTeams(
  season: number,
  deps: StatsDeps,
  deadline: number,
): Promise<{ events: number; eventsRefreshed: number; teams: number; remaining: number; complete: boolean }> {
  const clock = deps.clock ?? Date.now;
  const outOfTime = () => clock() >= deadline;
  const today = localDate(deps.now, 'America/New_York');
  const recent = (await listSeasonEvents(season, deps)).filter(
    (e) => e.start_date <= today && e.end_date >= addDays(today, -8),
  );

  // One load per event per run, shared by every team that played there. Finished events read tba_cache.
  const memo = new Map<string, Promise<TeamEventSummary[]>>();
  const summariesFor = (event: TbaEvent) => {
    let p = memo.get(event.key);
    if (!p) {
      p = loadEventSummaries(event, deps, statsWindowMs(event, deps.now, CRON_FINAL_WINDOW_MS));
      memo.set(event.key, p);
    }
    return p;
  };

  const teamSet = new Set<string>();
  let eventsRefreshed = 0;
  const allLoaded = await eachLimited(await stalestFirst(recent, deps.repo), RECENT_EVENT_CONCURRENCY, outOfTime, async (event) => {
    for (const s of await summariesFor(event)) teamSet.add(s.teamKey);
    eventsRefreshed += 1;
  });
  if (!allLoaded) {
    return { events: recent.length, eventsRefreshed, teams: 0, remaining: teamSet.size, complete: false };
  }

  const existing = await deps.repo.getTeamStats([...teamSet], [season]);
  const updatedAt = new Map(existing.map((r) => [r.teamKey, r.updatedAt]));
  // Never-updated teams sort first ('' < any ISO time), then the stalest.
  const order = [...teamSet].sort(
    (a, b) => (updatedAt.get(a) ?? '').localeCompare(updatedAt.get(b) ?? '') || a.localeCompare(b),
  );

  let done = 0;
  for (const teamKey of order) {
    if (outOfTime()) break;
    const summaries: TeamEventSummary[] = [];
    for (const event of await teamSeasonEvents(teamKey, season, deps)) {
      summaries.push(...(await summariesFor(event)).filter((s) => s.teamKey === teamKey));
    }
    const row = aggregateTeamSeason(teamKey, season, summaries, deps.now.toISOString());
    if (row.eventsPlayed > 0) await deps.repo.upsertTeamStats([row]);
    done += 1;
  }
  return {
    events: recent.length,
    eventsRefreshed,
    teams: done,
    remaining: order.length - done,
    complete: done === order.length,
  };
}
