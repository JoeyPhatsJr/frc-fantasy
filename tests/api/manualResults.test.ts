import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);

import { setUser } from '../helpers/auth';
import {
  DELETE as clearResult,
  PUT as putResult,
} from '@/app/api/l/[slug]/admin/rounds/[id]/results/[teamKey]/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;
let round: RoundRow;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  h.getTba = vi.fn(async () => ({ data: null, fetchedAt: null, stale: true }));
  const seeded = await seedLeague(repo);
  league = seeded.league;
  setUser(seeded.user);
  round = await repo.createRound({
    leagueId: league.id, eventKey: null, kind: 'manual', eventName: 'Garage Games',
    startDate: '2026-11-07', endDate: '2026-11-07', timezone: 'America/New_York', scoring: defaultScoring(),
  });
  await repo.addExtraTeam(round.id, 'frc341');
  await repo.addExtraTeam(round.id, 'frc5181');
});

const at = (teamKey: string, r: RoundRow = round) => params({ slug: league.slug, id: r.id, teamKey });
const put = (teamKey: string, body: unknown, r?: RoundRow) => putResult(request('PUT', '/x', { body }), at(teamKey, r));

describe('PUT manual result', () => {
  it('saves a full result and fills defaults for missing fields', async () => {
    const res = await put('frc5181', { qualWins: 7, qualLosses: 2, qualRank: 3, allianceRole: 'captain', awardTypes: [0] });
    expect(res.status).toBe(200);
    expect((await readJson(res)).result).toEqual({
      teamKey: 'frc5181', qualWins: 7, qualLosses: 2, qualTies: 0, rankingPoints: null, qualRank: 3,
      allianceRole: 'captain', playoffWins: 0, eventResult: null, awardTypes: [0],
    });
    expect(await repo.listManualResults(round.id)).toHaveLength(1);
  });

  it('replaces the whole row on a second save', async () => {
    await put('frc5181', { qualWins: 7, awardTypes: [0] });
    await put('frc5181', { qualWins: 8 });
    expect((await repo.listManualResults(round.id))[0]).toMatchObject({ qualWins: 8, awardTypes: [] });
  });

  it('accepts a team typed as "341" or " frc341 " (Review Focus 3)', async () => {
    expect((await put('341', { qualWins: 1 })).status).toBe(200);
    expect((await put(' frc341 ', { qualWins: 2 })).status).toBe(200);
    expect((await repo.listManualResults(round.id)).map((r) => [r.teamKey, r.qualWins])).toEqual([['frc341', 2]]);
  });

  it('rejects a team outside the pool and junk team input (Review Focus 3)', async () => {
    const outside = await put('254', { qualWins: 1 });
    expect(outside.status).toBe(400);
    expect((await readJson(outside)).error).toBe("That team isn't in this round's team pool");
    const junk = await put('34a1', { qualWins: 1 });
    expect(junk.status).toBe(400);
    expect((await readJson(junk)).error).toBe('Team numbers look like 341');
  });

  it.each([
    [{ qualWins: 51 }, 'Qual wins must be a whole number from 0 to 50'],
    [{ qualTies: -1 }, 'Qual ties must be a whole number from 0 to 50'],
    [{ rankingPoints: 501 }, 'Ranking points must be a whole number from 0 to 500'],
    [{ qualRank: 0 }, 'Rank must be a whole number from 1 to 200'],
    [{ playoffWins: 21 }, 'Playoff wins must be a whole number from 0 to 20'],
    [{ allianceRole: 'pick4' }, 'Alliance role must be captain, pick1, pick2, pick3 or backup'],
    [{ eventResult: 'semifinalist' }, 'Event result must be winner or finalist'],
    [{ awardTypes: [0, 0] }, 'Each award can only be listed once'],
  ])('rejects %j', async (body, message) => {
    const res = await put('frc5181', body);
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe(message);
  });

  it('answers 409 for a TBA round', async () => {
    const tbaRound = await repo.createRound({
      leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
      startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    const res = await put('frc5181', { qualWins: 1 }, tbaRound);
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('Results can only be entered for manual events');
  });

  it('is commissioner-only', async () => {
    setUser(null);
    expect((await put('frc5181', {})).status).toBe(401);
  });
});

describe('DELETE manual result', () => {
  it('clears the row', async () => {
    await put('frc5181', { qualWins: 7 });
    const res = await clearResult(request('DELETE', '/x'), at('5181'));
    expect(res.status).toBe(204);
    expect(await repo.listManualResults(round.id)).toEqual([]);
  });
});
