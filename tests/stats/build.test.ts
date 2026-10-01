import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  getRepo: () => {
    throw new Error('the builder must use deps.repo');
  },
}));

import { buildSeasonStats, NEVER_REFETCH_MS, statsWindowMs } from '@/lib/stats/build';
import type { EventData, TbaEvent } from '@/lib/tba/types';
import { alliance, emptyEvent, match } from '../helpers/builders';
import { loadFixture, loadFixtureEvent } from '../helpers/fixture';
import { createMemoryRepo } from '../helpers/memoryRepo';

const NOW = new Date('2026-10-01T16:00:00.000Z');
const parrEvent = loadFixtureEvent('2025parr');
const EVENTS: TbaEvent[] = [
  { ...parrEvent, event_type: 99 },
  { key: '2025cmptx', name: 'Einstein', start_date: '2025-04-19', end_date: '2025-04-19', timezone: 'America/Chicago', event_type: 4 },
  { key: '2025week0', name: 'Week Zero', start_date: '2025-02-15', end_date: '2025-02-15', timezone: 'America/New_York', event_type: 100 },
];
const DATA: Record<string, EventData> = {
  '2025parr': loadFixture('2025parr'),
  '2025cmptx': {
    ...emptyEvent(),
    alliances: [alliance(['frc1', 'frc2', 'frc3']), alliance(['frc4', 'frc5', 'frc6'])],
    matches: [match({ level: 'f', num: 1, red: ['frc1', 'frc2', 'frc3'], blue: ['frc4', 'frc5', 'frc6'], redScore: 9, blueScore: 1 })],
  },
};
const SUFFIX: Record<string, keyof EventData> = {
  'teams/simple': 'teams', 'matches/simple': 'matches', rankings: 'rankings',
  alliances: 'alliances', awards: 'awards', oprs: 'oprs',
};

function fakeTba() {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = String(url).replace('https://www.thebluealliance.com/api/v3', '');
    calls.push(u);
    if (u === '/events/2025/simple') return Response.json(EVENTS);
    const m = /^\/event\/([^/]+)\/(.+)$/.exec(u);
    const body = m ? (DATA[m[1]]?.[SUFFIX[m[2]]] ?? null) : null;
    return new Response(JSON.stringify(body), { status: 200, headers: { etag: '"x"' } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('statsWindowMs', () => {
  it('never refetches past seasons, uses 24 h for finished current-season events, 10 min for recent ones', () => {
    expect(statsWindowMs({ key: '2025parr', end_date: '2025-10-18' }, NOW)).toBe(NEVER_REFETCH_MS);
    expect(statsWindowMs({ key: '2026paca', end_date: '2026-03-08' }, NOW)).toBe(24 * 60 * 60_000);
    expect(statsWindowMs({ key: '2026parr', end_date: '2026-09-28' }, NOW)).toBe(10 * 60_000);
  });
});

describe('buildSeasonStats', () => {
  it('writes one row per team that played quals, skipping preseason and Einstein', async () => {
    const repo = createMemoryRepo();
    const tba = fakeTba();
    const log: string[] = [];

    const result = await buildSeasonStats(2025, { repo, now: NOW, tba: { fetchImpl: tba.fetchImpl, apiKey: 'k' } }, { log: (l) => log.push(l) });

    expect(tba.calls.some((c) => c.includes('2025week0'))).toBe(false);
    expect(result.events).toBe(2);
    expect(result.skipped).toEqual(['2025cmptx']);
    expect(result.teams).toBeGreaterThan(30);
    expect(log.length).toBeGreaterThanOrEqual(2);

    const [row] = await repo.getTeamStats(['frc2607'], [2025], { withHistory: true });
    expect(row).toMatchObject({ eventsPlayed: 1, bestFinish: 'winner', latestEventKey: '2025parr', latestOpr: 89.5, latestRank: 3 });
    expect(row.events[0].eventKey).toBe('2025parr');
    expect(await repo.getTeamStats(['frc1'], [2025])).toEqual([]); // Einstein-only team: no row
  });

  it('is resumable: a second run of a past season makes no TBA requests', async () => {
    const repo = createMemoryRepo();
    const tba = fakeTba();
    const deps = { repo, now: NOW, tba: { fetchImpl: tba.fetchImpl, apiKey: 'k' } };
    await buildSeasonStats(2025, deps);
    const first = tba.calls.length;

    await buildSeasonStats(2025, deps);
    expect(tba.calls.length).toBe(first);
  });
});
