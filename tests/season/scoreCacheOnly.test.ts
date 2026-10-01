import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Final review I1: the real getTba and getEventScores (no mocks of either), a fake tba_cache,
// and a spied global fetch. Once the budget is spent, nothing may reach the network.
const h = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));

import type { Repo } from '@/lib/db/repo';
import type { RoundRow } from '@/lib/db/types';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { scoreEvent } from '@/lib/scoring/engine';
import { configHash } from '@/lib/scores/hash';
import { createFetchBudget } from '@/lib/season/budget';
import { scoreSeasonRound } from '@/lib/season/score';
import { cleanEventData } from '@/lib/tba/clean';
import { eventPaths } from '@/lib/tba/event';
import type { EventData } from '@/lib/tba/types';
import { emptyEvent, match, rankRow, rankings } from '../helpers/builders';
import { createMemoryRepo } from '../helpers/memoryRepo';

const NOW = new Date('2027-03-14T16:00:00.000Z');
const LONG_AGO = '2027-03-01T00:00:00.000Z'; // far outside every cache window
const round = { id: 'r1', kind: 'season', seasonYear: 2027, scoring: DEFAULT_SCORING, finalizedAt: null } as unknown as RoundRow;

const RED = ['frc5181', 'frc2', 'frc3'];
const BLUE = ['frc4', 'frc5', 'frc6'];
const PACA: EventData = {
  ...emptyEvent(),
  teams: [...RED, ...BLUE].map((key) => ({ key, team_number: Number(key.slice(3)), nickname: key })),
  rankings: rankings([rankRow(1, 'frc5181', [1, 0, 0], { extra_stats: [3] })]),
  matches: [match({ num: 1, red: RED, blue: BLUE, redScore: 50, blueScore: 10 })],
};

let repo: Repo;
let fetchSpy: ReturnType<typeof vi.spyOn>;

async function cache(path: string, body: unknown) {
  await repo.upsertCache({ path, etag: '"old"', body, fetchedAt: LONG_AGO, lastError: null, lastErrorAt: null });
}

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  vi.stubEnv('TBA_API_KEY', 'test-key'); // so a missing key can't be what stops the fetch
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not be used'));

  await cache('/team/frc5181/events/2027/simple', [
    { key: '2027paca', name: 'Greater Pittsburgh', event_type: 0, start_date: '2027-03-05', end_date: '2027-03-07' },
    { key: '2027pahat', name: 'Hatboro', event_type: 0, start_date: '2027-03-13', end_date: '2027-03-15' },
  ]);
  // 2027paca is fully cached (old). 2027pahat was never cached. frc341's event list was never cached.
  const paths = eventPaths('2027paca');
  for (const name of Object.keys(paths) as (keyof EventData)[]) await cache(paths[name], PACA[name]);
});

afterEach(() => {
  fetchSpy.mockRestore();
  vi.unstubAllEnvs();
});

describe('scoreSeasonRound once the budget is spent (final review I1)', () => {
  it('reads tba_cache only: zero network fetches, cached events still score, the page is stale', async () => {
    let t = 0;
    const spent = createFetchBudget({ maxInFlight: 4, budgetMs: 0, clock: () => t++ });

    const out = await scoreSeasonRound(round, ['frc5181', 'frc341'], NOW, spent);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.stale).toBe(true);
    const expected = scoreEvent(cleanEventData(PACA), DEFAULT_SCORING).teams.get('frc5181')!.total;
    expect(expected).toBeGreaterThan(0);
    expect(out.detail.frc5181.events.map((e) => [e.eventKey, e.total])).toEqual([
      ['2027paca', expected],
      ['2027pahat', 0], // never cached: no data
    ]);
    expect(out.teams.get('frc341')!.total).toBe(0);
    expect(await repo.getEventScoresRow('2027pahat', configHash(DEFAULT_SCORING))).toBeNull();
  });
});
