import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  getRepo: () => {
    throw new Error('use deps.repo');
  },
}));

import type { Repo } from '@/lib/db/repo';
import { refreshRecentTeams } from '@/lib/stats/build';
import type { EventData, TbaEvent } from '@/lib/tba/types';
import { emptyEvent, match } from '../helpers/builders';
import { createMemoryRepo } from '../helpers/memoryRepo';

const ev = (key: string, start: string, end: string): TbaEvent => ({
  key, name: key, start_date: start, end_date: end, timezone: 'America/New_York', event_type: 1,
});
// "Today" is 2026-03-20 in Eastern time.
const EVENTS = [
  ev('2026old', '2026-03-01', '2026-03-03'), // ended more than 8 days ago: skipped
  ev('2026aaa', '2026-03-14', '2026-03-16'), // recent
  ev('2026bbb', '2026-03-19', '2026-03-21'), // happening now
  ev('2026zzz', '2026-03-27', '2026-03-29'), // future: skipped
];
const played = (red: string[], blue: string[]): EventData => ({
  ...emptyEvent(),
  matches: [match({ num: 1, red, blue, redScore: 10, blueScore: 5 })],
});
const DATA: Record<string, EventData> = {
  '2026old': played(['frc91', 'frc92', 'frc93'], ['frc94', 'frc95', 'frc96']),
  '2026aaa': played(['frc1', 'frc2', 'frc3'], ['frc4', 'frc5', 'frc6']),
  '2026bbb': played(['frc11', 'frc12', 'frc13'], ['frc14', 'frc15', 'frc16']),
};
const SUFFIX: Record<string, keyof EventData> = {
  'teams/simple': 'teams', 'matches/simple': 'matches', rankings: 'rankings',
  alliances: 'alliances', awards: 'awards', oprs: 'oprs',
};
const eventOf = (team: number) => (team < 10 ? EVENTS[1] : team < 90 ? EVENTS[2] : EVENTS[0]);

function setup() {
  let t = 0;
  const inner = createMemoryRepo();
  const repo: Repo = {
    ...inner,
    upsertTeamStats: async (rows) => {
      t += 20_000; // each team's write "takes" 20 s of the budget
      return inner.upsertTeamStats(rows);
    },
  };
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = String(url).replace('https://www.thebluealliance.com/api/v3', '');
    calls.push(u);
    if (u === '/events/2026/simple') return Response.json(EVENTS);
    const team = /^\/team\/frc(\d+)\/events\/2026\/simple$/.exec(u);
    if (team) return Response.json([eventOf(Number(team[1]))]);
    const m = /^\/event\/([^/]+)\/(.+)$/.exec(u);
    return Response.json(m ? (DATA[m[1]]?.[SUFFIX[m[2]]] ?? null) : null);
  }) as typeof fetch;
  const deps = (now: string) => ({
    repo,
    now: new Date(now),
    clock: () => t,
    tba: { fetchImpl, apiKey: 'k', now: () => new Date(now) },
  });
  return { repo, calls, deps, resetClock: () => (t = 0) };
}

async function teamsWithRows(repo: Repo): Promise<string[]> {
  const keys = [1, 2, 3, 4, 5, 6, 11, 12, 13, 14, 15, 16, 91].map((n) => `frc${n}`);
  return (await repo.getTeamStats(keys, [2026])).map((r) => r.teamKey).sort();
}

describe('refreshRecentTeams', () => {
  it('only refreshes teams at events inside [today − 8, today]', async () => {
    const { repo, deps } = setup();
    const res = await refreshRecentTeams(2026, deps('2026-03-20T15:00:00.000Z'), 1_000_000); // plenty of budget
    expect(res).toMatchObject({ events: 2, teams: 12, remaining: 0, complete: true });
    const rows = await teamsWithRows(repo);
    expect(rows).toHaveLength(12);
    expect(rows).not.toContain('frc91');
  });

  // Review Focus 4.
  it('stops at the budget, reports it, and starts the next run with the teams it missed', async () => {
    const { repo, deps, resetClock } = setup();

    const first = await refreshRecentTeams(2026, deps('2026-03-20T15:00:00.000Z'), 50_000);
    expect(first).toMatchObject({ events: 2, teams: 3, remaining: 9, complete: false });
    const afterFirst = await teamsWithRows(repo);
    expect(afterFirst).toHaveLength(3);

    resetClock();
    const second = await refreshRecentTeams(2026, deps('2026-03-21T15:00:00.000Z'), 50_000);
    expect(second.teams).toBe(3);
    const afterSecond = await teamsWithRows(repo);
    expect(afterSecond).toHaveLength(6); // three NEW teams, not the same three again
    for (const k of afterFirst) expect(afterSecond).toContain(k);
  });

  it('does nothing (and does not throw) when TBA has no event list', async () => {
    const repo = createMemoryRepo();
    const fetchImpl = (async () => { throw new Error('offline'); }) as typeof fetch;
    const res = await refreshRecentTeams(2026, { repo, now: new Date('2026-03-20T15:00:00.000Z'), tba: { fetchImpl, apiKey: 'k' } }, Date.now() + 50_000);
    expect(res).toEqual({ events: 0, eventsRefreshed: 0, teams: 0, remaining: 0, complete: true });
  });
});

// Final review I3: the recent-event phase must not redo the same events every run.
describe('refreshRecentTeams event phase', () => {
  // "Today" is 2026-03-20 in Eastern time; ten events all running now, each with its own six teams.
  const RECENT = Array.from({ length: 10 }, (_, i) => ev(`2026e${i}`, '2026-03-19', '2026-03-21'));
  const teamsAt = (i: number) => [1, 2, 3, 4, 5, 6].map((n) => `frc${i * 10 + n + 100}`);
  const RECENT_DATA: Record<string, EventData> = Object.fromEntries(
    RECENT.map((e, i) => [e.key, played(teamsAt(i).slice(0, 3), teamsAt(i).slice(3))]),
  );

  function setupMany(costPerEvent: number, delayMs = 0) {
    let t = 0;
    let active = 0;
    let maxActive = 0;
    const repo = createMemoryRepo();
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url).replace('https://www.thebluealliance.com/api/v3', '');
      calls.push(u);
      if (u === '/events/2026/simple') return Response.json(RECENT);
      const team = /^\/team\/frc(\d+)\/events\/2026\/simple$/.exec(u);
      if (team) return Response.json([RECENT[Math.floor((Number(team[1]) - 100) / 10)]]);
      const m = /^\/event\/([^/]+)\/(.+)$/.exec(u);
      if (m && m[2] === 'matches/simple') {
        t += costPerEvent; // loading one event "takes" this much of the budget
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, delayMs));
        active -= 1;
      }
      return Response.json(m ? (RECENT_DATA[m[1]]?.[SUFFIX[m[2]]] ?? null) : null);
    }) as typeof fetch;
    const deps = (now: string) => ({ repo, now: new Date(now), clock: () => t, tba: { fetchImpl, apiKey: 'k', now: () => new Date(now) } });
    const loadedEvents = (since: number) =>
      [...new Set(calls.slice(since).map((c) => /^\/event\/([^/]+)\/matches/.exec(c)?.[1]).filter(Boolean))].sort();
    return { deps, calls, loadedEvents, maxActive: () => maxActive, resetClock: () => (t = 0) };
  }

  it('loads several recent events at once, but never more than four', async () => {
    const { deps, maxActive } = setupMany(0, 5);
    const res = await refreshRecentTeams(2026, deps('2026-03-20T15:00:00.000Z'), 1_000_000);
    expect(res).toMatchObject({ events: 10, eventsRefreshed: 10, teams: 60, complete: true });
    expect(maxActive()).toBeGreaterThan(1);
    expect(maxActive()).toBeLessThanOrEqual(4);
  });

  it('hits the deadline twice in a row and still makes progress: each run starts with the stalest events', async () => {
    const { deps, calls, loadedEvents, resetClock } = setupMany(20_000);

    const first = await refreshRecentTeams(2026, deps('2026-03-20T15:00:00.000Z'), 50_000);
    expect(first).toMatchObject({ events: 10, teams: 0, complete: false });
    const firstLoaded = loadedEvents(0);
    expect(first.eventsRefreshed).toBe(firstLoaded.length);
    expect(firstLoaded.length).toBeGreaterThan(0);
    expect(firstLoaded.length).toBeLessThan(10);

    resetClock();
    const mark = calls.length;
    const second = await refreshRecentTeams(2026, deps('2026-03-21T15:00:00.000Z'), 50_000);
    expect(second.complete).toBe(false);
    const secondLoaded = loadedEvents(mark);
    expect(secondLoaded.length).toBeGreaterThan(0);
    for (const key of secondLoaded) expect(firstLoaded).not.toContain(key); // new events, not the same ones again
  });
});

// Final review I3: per-team loads must not refetch finished current-season events every day.
describe('refreshRecentTeams per-team loads', () => {
  it('reads current-season events that ended more than 8 days ago from tba_cache, even a day later', async () => {
    const repo = createMemoryRepo();
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url).replace('https://www.thebluealliance.com/api/v3', '');
      calls.push(u);
      if (u === '/events/2026/simple') return Response.json(EVENTS);
      if (/^\/team\/frc\d+\/events\/2026\/simple$/.test(u)) return Response.json([EVENTS[0], EVENTS[1]]);
      const m = /^\/event\/([^/]+)\/(.+)$/.exec(u);
      return Response.json(m ? (DATA[m[1]]?.[SUFFIX[m[2]]] ?? null) : null);
    }) as typeof fetch;
    const deps = (now: string) => ({ repo, now: new Date(now), tba: { fetchImpl, apiKey: 'k', now: () => new Date(now) } });

    await refreshRecentTeams(2026, deps('2026-03-20T15:00:00.000Z'), Number.POSITIVE_INFINITY);
    expect(calls.some((c) => c.startsWith('/event/2026old/'))).toBe(true);

    const mark = calls.length;
    await refreshRecentTeams(2026, deps('2026-03-22T15:00:00.000Z'), Number.POSITIVE_INFINITY);
    expect(calls.slice(mark).filter((c) => c.startsWith('/event/2026old/'))).toEqual([]);
    expect(calls.slice(mark).some((c) => c.startsWith('/event/2026aaa/'))).toBe(true); // recent ones still refresh
  });
});
