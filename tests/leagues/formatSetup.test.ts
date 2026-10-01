import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import type { Repo } from '@/lib/db/repo';
import { checkFormatOptions, formatOptionsSchema, setUpLeagueFormat } from '@/lib/leagues/formatSetup';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

const NOW = new Date('2026-10-23T18:00:00.000Z');
let repo: Repo;

beforeEach(() => {
  repo = createMemoryRepo();
  h.repo = repo;
  h.getTba = vi.fn(async (path: unknown) =>
    String(path) === '/events/2027/simple'
      ? { data: [{ key: '2027paca', name: 'x', event_type: 1, start_date: '2027-03-05', end_date: '2027-03-07' }], fetchedAt: 'x', stale: false }
      : { data: [], fetchedAt: 'x', stale: false },
  );
});

describe('formatOptionsSchema', () => {
  const parse = (v: unknown) => formatOptionsSchema.safeParse(v);
  it('defaults to an event league', () => {
    expect(parse({}).data).toEqual({ format: 'event' });
  });
  it('rejects more than 3 follows and junk pool filters', () => {
    expect(parse({ format: 'event', followTeams: [1, 2, 3, 4] }).success).toBe(false);
    expect(parse({ format: 'season', poolFilter: { type: 'planet' } }).success).toBe(false);
  });
});

describe('checkFormatOptions', () => {
  it('is null for event leagues and resolves year + filter for season leagues', () => {
    expect(checkFormatOptions({ format: 'event' }, NOW)).toBeNull();
    expect(checkFormatOptions({ format: 'season' }, NOW)).toEqual({ year: 2027, filter: { type: 'all' } });
    expect(checkFormatOptions({ format: 'season', seasonYear: 2026 }, NOW)).toEqual({ year: 2026, filter: { type: 'all' } });
  });
  it('refuses a district from another season', () => {
    expect(() =>
      checkFormatOptions({ format: 'season', seasonYear: 2027, poolFilter: { type: 'district', key: '2026fma' } }, NOW),
    ).toThrow('Pick a district from the 2027 season');
  });
});

describe('setUpLeagueFormat', () => {
  it('a season league gets one "{year} Season" round with roster 8, the filter, and TBA calendar dates', async () => {
    const { league } = await seedLeague(repo, { format: 'season' });
    await setUpLeagueFormat(league, { format: 'season', seasonYear: 2027, poolFilter: { type: 'district', key: '2027fma' } }, NOW);
    const rounds = await repo.listRounds(league.id);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({
      kind: 'season', eventKey: null, seasonYear: 2027, eventName: '2027 Season', rosterSize: 8,
      startDate: '2027-03-05', endDate: '2027-03-07', timezone: 'America/New_York',
      poolFilter: { type: 'district', key: '2027fma' },
    });
    expect(rounds[0].scoring).toEqual(league.defaultScoring);
  });

  it('defaults the season year: next year from October on', async () => {
    const { league } = await seedLeague(repo, { format: 'season' });
    await setUpLeagueFormat(league, { format: 'season' }, NOW);
    expect((await repo.listRounds(league.id))[0]).toMatchObject({ seasonYear: 2027, poolFilter: { type: 'all' } });
  });

  it('refuses a season year other than this year or next', async () => {
    const { league } = await seedLeague(repo, { format: 'season' });
    await expect(setUpLeagueFormat(league, { format: 'season', seasonYear: 2029 }, NOW)).rejects.toThrow(
      'Pick the 2026 or 2027 season',
    );
  });

  it('an event league saves its follows', async () => {
    const { league } = await seedLeague(repo);
    await setUpLeagueFormat(league, { format: 'event', followTeams: [5181] }, NOW);
    expect(await repo.listFollows(league.id)).toEqual([5181]);
    expect(await repo.listRounds(league.id)).toEqual([]); // TBA had no events for 5181 here
  });

  it('an event league with no follows writes nothing', async () => {
    const { league } = await seedLeague(repo);
    await setUpLeagueFormat(league, { format: 'event' }, NOW);
    expect(await repo.listFollows(league.id)).toEqual([]);
    expect(h.getTba).not.toHaveBeenCalled();
  });
});
