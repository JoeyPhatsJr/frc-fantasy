import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import type { Repo } from '@/lib/db/repo';
import { loadPool } from '@/lib/rounds/pool';
import { defaultScoring } from '@/lib/scoring/config';
import { loadSeasonTbaTeams, seasonTeamsCachePath, seasonEmptyMessage } from '@/lib/season/pool';
import type { TeamSimple } from '@/lib/tba/types';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

const t = (n: number, state_prov: string, country: string): TeamSimple => ({
  key: `frc${n}`, team_number: n, nickname: `Team ${n}`, state_prov, country,
});
const PAGE0 = [t(1, 'Pennsylvania', 'USA'), t(2, 'Ontario', 'Canada'), t(3, 'pennsylvania', 'usa')];
const PAGE1 = [t(501, 'Texas', 'USA')];
const DISTRICT = [t(1, 'Pennsylvania', 'USA'), t(5181, 'Pennsylvania', 'USA')];

function tba(pages: TeamSimple[][], opts: { stale?: boolean } = {}) {
  h.getTba = vi.fn(async (path: unknown) => {
    const p = String(path);
    const page = /^\/teams\/2027\/(\d+)\/simple$/.exec(p);
    if (page) {
      const data = Number(page[1]) in pages ? pages[Number(page[1])] : [];
      return { data, fetchedAt: new Date().toISOString(), stale: opts.stale ?? false };
    }
    if (p === '/district/2027fma/teams/simple') return { data: DISTRICT, fetchedAt: 'x', stale: false };
    return { data: null, fetchedAt: null, stale: false };
  });
}

beforeEach(() => {
  h.repo = createMemoryRepo();
});

describe('"all" fetches pages in parallel batches of 4 (final review I6)', () => {
  const page = (n: number) => [t(n * 500 + 1, 'Texas', 'USA')];
  const pagesCalled = () =>
    (h.getTba as ReturnType<typeof vi.fn>).mock.calls.map((c) => Number(/\/teams\/2027\/(\d+)\//.exec(String(c[0]))![1]));

  it('keeps page order even when later pages answer first', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const pages = [0, 1, 2, 3, 4, 5].map(page);
    h.getTba = vi.fn(async (path: unknown) => {
      const n = Number(/\/teams\/2027\/(\d+)\//.exec(String(path))![1]);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, (8 - (n % 4)) * 2)); // later pages in a batch resolve first
      inFlight--;
      return { data: pages[n] ?? [], fetchedAt: new Date().toISOString(), stale: false };
    });
    const out = await loadSeasonTbaTeams(2027, { type: 'all' });
    expect(out.teams.map((x) => x.team_number)).toEqual([1, 501, 1001, 1501, 2001, 2501]);
    expect(maxInFlight).toBe(4);
  });

  it('stops after the batch holding the first empty page, and drops anything after that page', async () => {
    // Page 5 is empty; page 6 has teams but must not count (sequential paging would never reach it).
    tba([page(0), page(1), page(2), page(3), page(4), [], page(6), page(7), page(8)]);
    const out = await loadSeasonTbaTeams(2027, { type: 'all' });
    expect(pagesCalled()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(out.teams.map((x) => x.team_number)).toEqual([1, 501, 1001, 1501, 2001]);
  });

  it('treats a missing page (null data) as the end, like an empty one', async () => {
    tba([page(0), null as unknown as TeamSimple[], page(2)]);
    const out = await loadSeasonTbaTeams(2027, { type: 'all' });
    expect(pagesCalled()).toEqual([0, 1, 2, 3]);
    expect(out.teams.map((x) => x.team_number)).toEqual([1]);
  });

  it('never asks for more than 40 pages', async () => {
    h.getTba = vi.fn(async () => ({ data: page(0), fetchedAt: new Date().toISOString(), stale: false }));
    await loadSeasonTbaTeams(2027, { type: 'all' });
    expect(h.getTba).toHaveBeenCalledTimes(40);
  });

  it('marks the pool stale when any page was stale', async () => {
    h.getTba = vi.fn(async (path: unknown) => {
      const n = Number(/\/teams\/2027\/(\d+)\//.exec(String(path))![1]);
      return { data: n < 2 ? page(n) : [], fetchedAt: new Date().toISOString(), stale: n === 1 };
    });
    expect((await loadSeasonTbaTeams(2027, { type: 'all' })).stale).toBe(true);
  });
});

describe('"all" keeps a slim copy of the year\'s teams in tba_cache (final review I6)', () => {
  const repo = () => h.repo as Repo;
  const HOUR = 60 * 60_000;
  const full = (n: number): TeamSimple =>
    ({ ...t(n, 'Pennsylvania', 'USA'), city: 'Hatboro', name: 'A very long sponsor list'.repeat(5) }) as TeamSimple;

  it('after one walk, later loads read one row and call TBA zero times', async () => {
    tba([[full(1), full(2)], [full(501)]]);
    const first = await loadSeasonTbaTeams(2027, { type: 'all' });
    (h.getTba as ReturnType<typeof vi.fn>).mockClear();
    const again = await loadSeasonTbaTeams(2027, { type: 'all' });
    expect(h.getTba).not.toHaveBeenCalled();
    expect(again).toEqual({ ...first, teams: again.teams });
    expect(again.teams.map((x) => x.key)).toEqual(['frc1', 'frc2', 'frc501']);
    expect(again.stale).toBe(false);
    expect(again.published).toBe(true);
  });

  it('stores only what the pool and its filters use (no city or sponsor names)', async () => {
    tba([[full(1)]]);
    await loadSeasonTbaTeams(2027, { type: 'all' });
    const row = await repo().getCache(seasonTeamsCachePath(2027));
    expect(row?.body).toEqual([
      { key: 'frc1', team_number: 1, nickname: 'Team 1', state_prov: 'Pennsylvania', country: 'USA' },
    ]);
  });

  it('state and country filters work from the slim copy too', async () => {
    tba([PAGE0, PAGE1]);
    await loadSeasonTbaTeams(2027, { type: 'all' });
    (h.getTba as ReturnType<typeof vi.fn>).mockClear();
    const pa = await loadSeasonTbaTeams(2027, { type: 'state', country: 'usa', state: 'pennsylvania' });
    expect(pa.teams.map((x) => x.key)).toEqual(['frc1', 'frc3']);
    expect(h.getTba).not.toHaveBeenCalled();
  });

  it('dates the copy by its oldest page, so it never outlives the 24 h page window', async () => {
    const now = Date.now();
    const at = [now - 20 * HOUR, now - 2 * HOUR, now - HOUR];
    h.getTba = vi.fn(async (path: unknown) => {
      const n = Number(/\/teams\/2027\/(\d+)\//.exec(String(path))![1]);
      return { data: n < 2 ? [t(n * 500 + 1, 'Texas', 'USA')] : [], fetchedAt: new Date(at[Math.min(n, 2)]).toISOString(), stale: false };
    });
    await loadSeasonTbaTeams(2027, { type: 'all' });
    const row = await repo().getCache(seasonTeamsCachePath(2027));
    expect(row?.fetchedAt).toBe(new Date(at[0]).toISOString());
  });

  it('walks the pages again once the copy is a day old', async () => {
    await repo().upsertCache({
      path: seasonTeamsCachePath(2027),
      etag: null,
      body: [{ key: 'frc9', team_number: 9, nickname: 'Old', state_prov: null, country: null }],
      fetchedAt: new Date(Date.now() - 25 * HOUR).toISOString(),
      lastError: null,
      lastErrorAt: null,
    });
    tba([[t(1, 'Texas', 'USA')]]);
    const out = await loadSeasonTbaTeams(2027, { type: 'all' });
    expect(h.getTba).toHaveBeenCalled();
    expect(out.teams.map((x) => x.key)).toEqual(['frc1']);
    expect((await repo().getCache(seasonTeamsCachePath(2027)))?.body).toEqual([
      { key: 'frc1', team_number: 1, nickname: 'Team 1', state_prov: 'Texas', country: 'USA' },
    ]);
  });

  it('does not save a copy built from stale pages, or an empty year', async () => {
    tba([PAGE0], { stale: true });
    await loadSeasonTbaTeams(2027, { type: 'all' });
    expect(await repo().getCache(seasonTeamsCachePath(2027))).toBeNull();
    tba([]);
    await loadSeasonTbaTeams(2027, { type: 'all' });
    expect(await repo().getCache(seasonTeamsCachePath(2027))).toBeNull();
  });

  it('a failed save still returns the teams', async () => {
    tba([PAGE0]);
    const upsertCache = vi.spyOn(repo(), 'upsertCache').mockRejectedValue(new Error('db down'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await loadSeasonTbaTeams(2027, { type: 'all' });
    expect(upsertCache).toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith('Could not cache the 2027 team list', expect.any(Error));
    expect(out.teams).toHaveLength(3);
    logged.mockRestore();
  });

  it('districts do not use it', async () => {
    tba([PAGE0]);
    await loadSeasonTbaTeams(2027, { type: 'district', key: '2027fma' });
    expect(await repo().getCache(seasonTeamsCachePath(2027))).toBeNull();
  });
});

describe('loadSeasonTbaTeams (spec §5.5)', () => {
  it('"all" walks pages until an empty page, with a 24 h window', async () => {
    tba([PAGE0, PAGE1]);
    const out = await loadSeasonTbaTeams(2027, { type: 'all' });
    expect(out.teams.map((x) => x.key)).toEqual(['frc1', 'frc2', 'frc3', 'frc501']);
    expect(h.getTba).toHaveBeenCalledTimes(4); // one batch: pages 0-3, and page 2 is empty
    expect(h.getTba).toHaveBeenCalledWith('/teams/2027/0/simple', { windowMs: 24 * 60 * 60_000 });
  });

  it('"district" reads the district team list', async () => {
    tba([PAGE0]);
    const out = await loadSeasonTbaTeams(2027, { type: 'district', key: '2027fma' });
    expect(out.teams.map((x) => x.key)).toEqual(['frc1', 'frc5181']);
  });

  it('"state" and "country" filter all teams, ignoring case and spaces', async () => {
    tba([PAGE0, PAGE1]);
    const pa = await loadSeasonTbaTeams(2027, { type: 'state', country: ' USA', state: 'Pennsylvania ' });
    expect(pa.teams.map((x) => x.key)).toEqual(['frc1', 'frc3']);
    const canada = await loadSeasonTbaTeams(2027, { type: 'country', country: 'canada' });
    expect(canada.teams.map((x) => x.key)).toEqual(['frc2']);
  });
});

describe('loadPool for a season round', () => {
  async function seasonRound(poolFilter: unknown = null) {
    const repo = h.repo as Repo;
    const { league } = await seedLeague(repo, { format: 'season' });
    return repo.createRound({
      leagueId: league.id, eventKey: null, kind: 'season', seasonYear: 2027, eventName: '2027 Season',
      startDate: '2027-01-01', endDate: '2027-12-31', timezone: 'America/New_York', scoring: defaultScoring(),
      poolFilter: poolFilter as never,
    });
  }

  it('uses the round filter (null = all teams)', async () => {
    tba([PAGE0]);
    const pool = await loadPool(await seasonRound(), new Date());
    expect(pool).toMatchObject({ tbaCount: 3, stale: false, emptyMessage: null });
  });

  it('applies a saved filter and merges hand-added teams', async () => {
    tba([PAGE0, PAGE1]);
    const round = await seasonRound({ type: 'country', country: 'Canada' });
    await (h.repo as Repo).addExtraTeam(round.id, 'frc9999');
    const pool = await loadPool(round, new Date());
    expect(pool.tbaCount).toBe(1);
    expect(pool.teams.map((x) => x.teamKey).sort()).toEqual(['frc2', 'frc9999']);
    expect(pool.emptyMessage).toBeNull();
  });

  it('explains an unpublished team list (Review Focus 5)', async () => {
    tba([]);
    const pool = await loadPool(await seasonRound(), new Date());
    expect(pool.teams).toEqual([]);
    expect(pool.emptyMessage).toBe("TBA hasn't published 2027 teams yet — usually by January.");
    expect(seasonEmptyMessage(2027)).toBe(pool.emptyMessage);
  });

  it('does not blame TBA for being empty when TBA just could not be reached', async () => {
    tba([], { stale: true });
    const pool = await loadPool(await seasonRound(), new Date());
    expect(pool).toMatchObject({ stale: true, tbaCount: 0, emptyMessage: null });
  });
});

describe('loadPool for event rounds keeps emptyMessage null', () => {
  it('tba and manual rounds', async () => {
    tba([]);
    const repo = h.repo as Repo;
    const { league } = await seedLeague(repo);
    const tbaRound = await repo.createRound({
      leagueId: league.id, eventKey: '2027paca', eventName: 'x', startDate: '2027-03-05', endDate: '2027-03-07',
      timezone: 'America/New_York', scoring: defaultScoring(),
    });
    const manual = await repo.createRound({
      leagueId: league.id, eventKey: null, kind: 'manual', eventName: 'y', startDate: '2027-03-05', endDate: '2027-03-05',
      timezone: 'America/New_York', scoring: defaultScoring(),
    });
    expect((await loadPool(tbaRound, new Date())).emptyMessage).toBeNull();
    expect((await loadPool(manual, new Date())).emptyMessage).toBeNull();
  });
});
