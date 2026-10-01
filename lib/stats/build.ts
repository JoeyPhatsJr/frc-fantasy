import type { Repo } from '@/lib/db/repo';
import { addDays, localDate, MINUTE_MS } from '@/lib/rounds/status';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { getEventScores } from '@/lib/scores/eventScores';
import { aggregateTeamSeason, summarizeEvent, type TeamEventSummary } from '@/lib/stats/summarize';
import { cleanEventData } from '@/lib/tba/clean';
import { getTba, type TbaDeps } from '@/lib/tba/client';
import { loadEventData } from '@/lib/tba/event';
import type { TbaEvent } from '@/lib/tba/types';

/** Past seasons are final: once a path is cached it is never fetched again (spec §6.2). */
export const NEVER_REFETCH_MS = Number.POSITIVE_INFINITY;
const DAY_MS = 24 * 60 * MINUTE_MS;
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

export function statsWindowMs(event: { key: string; end_date: string; timezone?: string | null }, now: Date): number {
  const today = localDate(now, event.timezone ?? null);
  if (Number(event.key.slice(0, 4)) < Number(today.slice(0, 4))) return NEVER_REFETCH_MS;
  if (event.end_date < addDays(today, -8)) return DAY_MS;
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
export async function loadEventSummaries(event: TbaEvent, deps: StatsDeps): Promise<TeamEventSummary[]> {
  const windowMs = statsWindowMs(event, deps.now);
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
    if (summaries.length === 0) skipped.push(event.key);
    all.push(...summaries);
    log(`[${i + 1}/${events.length}] ${event.key}  ${summaries.length} teams`);
  }

  const byTeam = new Map<string, TeamEventSummary[]>();
  for (const s of all) byTeam.set(s.teamKey, [...(byTeam.get(s.teamKey) ?? []), s]);
  const updatedAt = deps.now.toISOString();
  const rows = [...byTeam].map(([teamKey, list]) => aggregateTeamSeason(teamKey, season, list, updatedAt));
  await deps.repo.upsertTeamStats(rows);
  return { events: events.length, teams: rows.length, skipped };
}

export async function teamSeasonEvents(teamKey: string, season: number, deps: StatsDeps): Promise<TbaEvent[]> {
  const res = await getTba<unknown[]>(`/team/${teamKey}/events/${season}/simple`, { windowMs: 10 * MINUTE_MS }, tbaDeps(deps));
  return (Array.isArray(res.data) ? res.data.filter(isEvent) : []).filter(countsForStats);
}

/**
 * The daily cron's team_stats job (spec §6.2): re-score current-season events with any day in
 * [today − 8, today], then rebuild the season row of every team at them. Stops at `deadline`;
 * teams are taken least-recently-updated first, so the next run continues where this one stopped.
 */
export async function refreshRecentTeams(
  season: number,
  deps: StatsDeps,
  deadline: number,
): Promise<{ events: number; teams: number; remaining: number; complete: boolean }> {
  const clock = deps.clock ?? Date.now;
  const today = localDate(deps.now, 'America/New_York');
  const recent = (await listSeasonEvents(season, deps)).filter(
    (e) => e.start_date <= today && e.end_date >= addDays(today, -8),
  );

  // One load per event per run, shared by every team that played there.
  const memo = new Map<string, Promise<TeamEventSummary[]>>();
  const summariesFor = (event: TbaEvent) => {
    let p = memo.get(event.key);
    if (!p) {
      p = loadEventSummaries(event, deps);
      memo.set(event.key, p);
    }
    return p;
  };

  const teamSet = new Set<string>();
  for (const event of recent) {
    if (clock() >= deadline) return { events: recent.length, teams: 0, remaining: teamSet.size, complete: false };
    for (const s of await summariesFor(event)) teamSet.add(s.teamKey);
  }

  const existing = await deps.repo.getTeamStats([...teamSet], [season]);
  const updatedAt = new Map(existing.map((r) => [r.teamKey, r.updatedAt]));
  // Never-updated teams sort first ('' < any ISO time), then the stalest.
  const order = [...teamSet].sort(
    (a, b) => (updatedAt.get(a) ?? '').localeCompare(updatedAt.get(b) ?? '') || a.localeCompare(b),
  );

  let done = 0;
  for (const teamKey of order) {
    if (clock() >= deadline) break;
    const summaries: TeamEventSummary[] = [];
    for (const event of await teamSeasonEvents(teamKey, season, deps)) {
      summaries.push(...(await summariesFor(event)).filter((s) => s.teamKey === teamKey));
    }
    if (summaries.length > 0) {
      await deps.repo.upsertTeamStats([aggregateTeamSeason(teamKey, season, summaries, deps.now.toISOString())]);
    }
    done += 1;
  }
  return { events: recent.length, teams: done, remaining: order.length - done, complete: done === order.length };
}
