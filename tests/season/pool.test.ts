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
import { loadSeasonTbaTeams, seasonEmptyMessage } from '@/lib/season/pool';
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
    if (page) return { data: pages[Number(page[1])] ?? [], fetchedAt: 'x', stale: opts.stale ?? false };
    if (p === '/district/2027fma/teams/simple') return { data: DISTRICT, fetchedAt: 'x', stale: false };
    return { data: null, fetchedAt: null, stale: false };
  });
}

beforeEach(() => {
  h.repo = createMemoryRepo();
});

describe('loadSeasonTbaTeams (spec §5.5)', () => {
  it('"all" walks pages until an empty page, with a 24 h window', async () => {
    tba([PAGE0, PAGE1]);
    const out = await loadSeasonTbaTeams(2027, { type: 'all' });
    expect(out.teams.map((x) => x.key)).toEqual(['frc1', 'frc2', 'frc3', 'frc501']);
    expect(h.getTba).toHaveBeenCalledTimes(3); // pages 0, 1 and the empty page 2
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
