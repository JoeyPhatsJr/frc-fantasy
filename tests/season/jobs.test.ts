import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import { DAILY_JOBS } from '@/lib/cron/jobs';
import type { Repo } from '@/lib/db/repo';
import { defaultScoring } from '@/lib/scoring/config';
import { seasonDatesJob } from '@/lib/season/jobs';
import { nextPoolFilter, nextSeasonYear } from '@/lib/season/next';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

describe('nextSeasonYear', () => {
  it('offers the next season only once the latest season is Final', () => {
    expect(nextSeasonYear([{ kind: 'season', seasonYear: 2027, status: 'final' }])).toBe(2028);
    expect(nextSeasonYear([{ kind: 'season', seasonYear: 2027, status: 'live' }])).toBeNull();
    expect(
      nextSeasonYear([
        { kind: 'season', seasonYear: 2027, status: 'final' },
        { kind: 'season', seasonYear: 2028, status: 'setup' },
      ]),
    ).toBeNull();
  });
  it('is null with no season rounds', () => {
    expect(nextSeasonYear([])).toBeNull();
    expect(nextSeasonYear([{ kind: 'tba', seasonYear: null, status: 'final' }])).toBeNull();
  });
});

describe('nextPoolFilter', () => {
  it('moves a district filter to next year and keeps the others', () => {
    expect(nextPoolFilter({ type: 'district', key: '2027fma' }, 2028)).toEqual({ type: 'district', key: '2028fma' });
    expect(nextPoolFilter({ type: 'country', country: 'Canada' }, 2028)).toEqual({ type: 'country', country: 'Canada' });
    expect(nextPoolFilter(null, 2028)).toEqual({ type: 'all' });
  });
});

describe('seasonDatesJob', () => {
  let repo: Repo;
  beforeEach(() => {
    repo = createMemoryRepo();
    h.repo = repo;
  });

  const makeSeasonRound = async () => {
    const { league } = await seedLeague(repo, { format: 'season' });
    return repo.createRound({
      leagueId: league.id, eventKey: null, kind: 'season', seasonYear: 2027, eventName: '2027 Season',
      startDate: '2027-01-01', endDate: '2027-12-31', timezone: 'America/New_York', scoring: defaultScoring(),
    });
  };

  it('moves open season rounds to the published calendar, and leaves them alone when TBA is down', async () => {
    const round = await makeSeasonRound();
    h.getTba = vi.fn(async () => ({ data: null, fetchedAt: null, stale: true }));
    await seasonDatesJob.run(new Date(), Date.now() + 60_000);
    expect((await repo.getRound(round.id))!.startDate).toBe('2027-01-01');

    h.getTba = vi.fn(async () => ({
      data: [{ key: '2027paca', name: 'x', event_type: 1, start_date: '2027-03-05', end_date: '2027-03-07' }],
      fetchedAt: 'x',
      stale: false,
    }));
    await seasonDatesJob.run(new Date(), Date.now() + 60_000);
    expect(await repo.getRound(round.id)).toMatchObject({ startDate: '2027-03-05', endDate: '2027-03-07' });
  });

  it('stops once the deadline has passed', async () => {
    const round = await makeSeasonRound();
    h.getTba = vi.fn(async () => ({
      data: [{ key: '2027paca', name: 'x', event_type: 1, start_date: '2027-03-05', end_date: '2027-03-07' }],
      fetchedAt: 'x',
      stale: false,
    }));
    await seasonDatesJob.run(new Date(), Date.now() - 1);
    expect(h.getTba).not.toHaveBeenCalled();
    expect((await repo.getRound(round.id))!.startDate).toBe('2027-01-01');
  });

  it('runs in the daily cron, after follow-sync', () => {
    const names = DAILY_JOBS.map((j) => j.name);
    expect(DAILY_JOBS).toContain(seasonDatesJob);
    expect(names.indexOf('season-dates')).toBeGreaterThan(names.indexOf('follow-sync'));
  });
});
