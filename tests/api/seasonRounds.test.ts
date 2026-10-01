import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);

import { setUser } from '../helpers/auth';
import { DELETE as deleteRound, PATCH as patchRound } from '@/app/api/l/[slug]/admin/rounds/[id]/route';
import { GET as getDistricts } from '@/app/api/districts/[year]/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, PlayerRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;
let me: PlayerRow;
let round: RoundRow;
let teamsPage0: unknown[];

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  teamsPage0 = Array.from({ length: 40 }, (_, i) => ({ key: `frc${i + 1}`, team_number: i + 1, country: 'USA', state_prov: 'Pennsylvania' }));
  h.getTba = vi.fn(async (path: unknown) => {
    const p = String(path);
    if (p === '/teams/2027/0/simple') return { data: teamsPage0, fetchedAt: 'x', stale: false };
    if (p === '/districts/2027') {
      return { data: [{ key: '2027fma', abbreviation: 'fma', display_name: 'FIRST Mid-Atlantic', year: 2027 }], fetchedAt: 'x', stale: false };
    }
    return { data: [], fetchedAt: 'x', stale: false };
  });
  const seeded = await seedLeague(repo, { format: 'season' });
  league = seeded.league;
  me = seeded.commissioner;
  setUser(seeded.user);
  round = await repo.createRound({
    leagueId: league.id, eventKey: null, kind: 'season', seasonYear: 2027, eventName: '2027 Season',
    startDate: '2027-01-01', endDate: '2027-12-31', timezone: 'America/New_York', scoring: defaultScoring(), rosterSize: 8,
  });
});

const patch = (body: unknown, r: RoundRow = round) =>
  patchRound(request('PATCH', '/x', { body }), params({ slug: league.slug, id: r.id }));

describe('PATCH a season round', () => {
  it('allows a roster of 15 but not 16', async () => {
    expect((await patch({ rosterSize: 15, draftOrder: [me.id] })).status).toBe(200);
    const res = await patch({ rosterSize: 16 });
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe('Roster size must be a whole number from 1 to 15');
  });

  it('still caps TBA rounds at 10', async () => {
    const tbaRound = await repo.createRound({
      leagueId: league.id, eventKey: '2027paca', eventName: 'x', startDate: '2027-03-05', endDate: '2027-03-07',
      timezone: 'America/New_York', scoring: defaultScoring(),
    });
    const res = await patch({ rosterSize: 11 }, tbaRound);
    expect((await readJson(res)).error).toBe('Roster size must be a whole number from 1 to 10');
  });

  it('saves a pool filter before the draft', async () => {
    const res = await patch({ poolFilter: { type: 'state', country: 'USA', state: 'Pennsylvania' } });
    expect(res.status).toBe(200);
    expect((await repo.getRound(round.id))!.poolFilter).toEqual({ type: 'state', country: 'USA', state: 'Pennsylvania' });
  });

  it('rejects a district from another season', async () => {
    const res = await patch({ poolFilter: { type: 'district', key: '2026fma' } });
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe('Pick a district from the 2027 season');
  });

  it('locks the pool filter once a pick exists', async () => {
    await repo.updateRound(round.id, { draftOrder: [me.id] });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: me.id, teamKey: 'frc1' });
    const res = await patch({ poolFilter: { type: 'country', country: 'Canada' } });
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('Undo all picks to change the team pool');
  });

  it('locks the pool filter once a live draft has started', async () => {
    await repo.updateRound(round.id, { draftOrder: [me.id], draftMode: 'live' });
    await repo.draftControl(round.id, 'start');
    const res = await patch({ poolFilter: { type: 'country', country: 'Canada' } });
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('Undo all picks to change the team pool');
  });

  it('refuses a pool filter on a non-season round', async () => {
    const manual = await repo.createRound({
      leagueId: league.id, eventKey: null, kind: 'manual', eventName: 'x', startDate: '2027-03-05', endDate: '2027-03-05',
      timezone: 'America/New_York', scoring: defaultScoring(),
    });
    expect((await patch({ poolFilter: { type: 'all' } }, manual)).status).toBe(409);
  });

  it('explains an unpublished team list instead of "only 0 teams" (Review Focus 5)', async () => {
    teamsPage0 = [];
    const res = await patch({ draftOrder: [me.id] });
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe("TBA hasn't published 2027 teams yet — usually by January.");
  });

  it('checks the roster size against the filter being saved', async () => {
    await repo.updateRound(round.id, { draftOrder: [me.id] });
    const res = await patch({ poolFilter: { type: 'country', country: 'Canada' } }); // matches none of the 40
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe('There are only 0 teams for 1 players. Add teams to the pool first.');
    expect((await repo.getRound(round.id))!.poolFilter).toBeNull();
    expect((await patch({ poolFilter: { type: 'country', country: 'USA' } })).status).toBe(200);
  });

  it('lets the commissioner pick a filter before TBA publishes the teams', async () => {
    teamsPage0 = [];
    await repo.updateRound(round.id, { draftOrder: [me.id] });
    expect((await patch({ poolFilter: { type: 'country', country: 'USA' } })).status).toBe(200);
  });

  it('round detail explains the empty pool and caps roster size at 15', async () => {
    teamsPage0 = [];
    const empty = await readJson(await patch({ scoring: defaultScoring() }));
    expect(empty.poolEmptyMessage).toBe("TBA hasn't published 2027 teams yet — usually by January.");
    teamsPage0 = Array.from({ length: 40 }, (_, i) => ({ key: `frc${i + 1}`, team_number: i + 1 }));
    const body = await readJson(await patch({ draftOrder: [me.id] }));
    expect(body.poolEmptyMessage).toBeNull();
    expect(body.maxRosterSize).toBe(15);
  });
});

describe('DELETE a season round (final review I4)', () => {
  const del = (r: RoundRow) => deleteRound(request('DELETE', '/x'), params({ slug: league.slug, id: r.id }));

  it("refuses to delete a league's only season, which would leave it empty for good", async () => {
    const res = await del(round);
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('A full-season league needs its season. Delete the league instead.');
    expect(await repo.listRounds(league.id)).toHaveLength(1);
  });

  it('allows deleting a season when another one is left', async () => {
    const next = await repo.createRound({
      leagueId: league.id, eventKey: null, kind: 'season', seasonYear: 2028, eventName: '2028 Season',
      startDate: '2028-01-01', endDate: '2028-12-31', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    expect((await del(next)).status).toBe(204);
    expect((await repo.listRounds(league.id)).map((r) => r.seasonYear)).toEqual([2027]);
  });
});

describe('GET /api/districts/{year}', () => {
  it('lists districts by name for signed-in users', async () => {
    const res = await getDistricts(request('GET', '/x'), params({ year: '2027' }));
    expect(await readJson(res)).toEqual({ districts: [{ key: '2027fma', name: 'FIRST Mid-Atlantic' }] });
  });
  it('needs sign-in and a sane year', async () => {
    expect((await getDistricts(request('GET', '/x'), params({ year: '20x7' }))).status).toBe(404);
    setUser(null);
    expect((await getDistricts(request('GET', '/x'), params({ year: '2027' }))).status).toBe(401);
  });
});
