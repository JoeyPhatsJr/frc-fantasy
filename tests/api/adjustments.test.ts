import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import {
  DELETE as deleteAdjustment,
  PATCH as patchAdjustment,
} from '@/app/api/l/[slug]/admin/rounds/[id]/adjustments/[adjId]/route';
import { POST as addAdjustment } from '@/app/api/l/[slug]/admin/rounds/[id]/adjustments/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, PlayerRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;
let token: string;
let round: RoundRow;
let mom: PlayerRow;

async function newRound(leagueId: string, eventKey = '2025parr') {
  return repo.createRound({
    leagueId, eventKey, eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
    scoring: defaultScoring(),
  });
}

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  ({ league, token } = await seedLeague(repo));
  mom = await repo.createPlayer(league.id, 'Mom');
  round = await newRound(league.id);
});

const here = () => params({ slug: league.slug, id: round.id });
const atAdj = (adjId: string) => params({ slug: league.slug, id: round.id, adjId });
const add = (body: unknown) => addAdjustment(request('POST', '/x', { token, body }), here());

describe('POST adjustments (§3.7)', () => {
  it('adds a team-targeted adjustment', async () => {
    const res = await add({ teamKey: 'frc341', points: 5, reason: '  Industrial Design Award ' });
    expect(res.status).toBe(201);
    const { adjustment } = await readJson(res);
    expect(adjustment).toMatchObject({
      playerId: null, teamKey: 'frc341', points: 5, reason: 'Industrial Design Award',
    });
    expect(await repo.listAdjustments(round.id)).toHaveLength(1);
  });

  it('adds a player-targeted adjustment, which may be negative', async () => {
    const res = await add({ playerId: mom.id, points: -10, reason: 'Late to the draft' });
    expect(res.status).toBe(201);
    expect((await readJson(res)).adjustment).toMatchObject({ playerId: mom.id, teamKey: null, points: -10 });
  });

  it('accepts a team nobody has drafted', async () => {
    expect((await add({ teamKey: 'frc9999', points: 5, reason: 'Spirit' })).status).toBe(201);
  });

  it('accepts a player who is not in the draft order (Deviation 2)', async () => {
    const gran = await repo.createPlayer(league.id, 'Gran');
    expect((await add({ playerId: gran.id, points: 7, reason: 'Guessed the winner' })).status).toBe(201);
  });

  it('answers 400 unless exactly one target is given', async () => {
    const bodies = [
      { points: 5, reason: 'x' },
      { playerId: mom.id, teamKey: 'frc341', points: 5, reason: 'x' },
      { playerId: null, teamKey: null, points: 5, reason: 'x' },
    ];
    for (const body of bodies) {
      const res = await add(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await readJson(res)).error).toBe('Choose one target: a player or a team');
    }
  });

  it("answers 400 for a player from another league or one that doesn't exist", async () => {
    const other = await seedLeague(repo, { slug: 'other-league-bbbbbb' });
    const stranger = await repo.createPlayer(other.league.id, 'Stranger');
    for (const playerId of [stranger.id, '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b']) {
      const res = await add({ playerId, points: 5, reason: 'x' });
      expect(res.status).toBe(400);
    }
  });

  it('answers 400 for bad points, reason, or team key', async () => {
    const bodies = [
      { teamKey: 'frc341', points: 1.5, reason: 'x' },
      { teamKey: 'frc341', points: 1001, reason: 'x' },
      { teamKey: 'frc341', points: -1001, reason: 'x' },
      { teamKey: 'frc341', points: '5', reason: 'x' },
      { teamKey: 'frc341', points: 5, reason: '' },
      { teamKey: 'frc341', points: 5, reason: '   ' },
      { teamKey: 'frc341', points: 5, reason: 'x'.repeat(201) },
      { teamKey: 'frc341', points: 5 },
      { teamKey: '341', points: 5, reason: 'x' },
      { playerId: 'not-a-uuid', points: 5, reason: 'x' },
    ];
    for (const body of bodies) {
      expect((await add(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await repo.listAdjustments(round.id)).toEqual([]);
  });

  it('accepts a reason of exactly 200 characters and points at the limits', async () => {
    expect((await add({ teamKey: 'frc341', points: 1000, reason: 'x'.repeat(200) })).status).toBe(201);
    expect((await add({ teamKey: 'frc341', points: -1000, reason: 'y' })).status).toBe(201);
  });

  it('answers 403 without a token', async () => {
    const res = await addAdjustment(
      request('POST', '/x', { body: { teamKey: 'frc341', points: 5, reason: 'x' } }),
      here(),
    );
    expect(res.status).toBe(403);
  });
});

describe('PATCH adjustments/{adjId}', () => {
  async function seeded() {
    return repo.insertAdjustment({
      roundId: round.id, playerId: null, teamKey: 'frc341', points: 5, reason: 'Award',
    });
  }

  it('changes only the fields that were sent', async () => {
    const adj = await seeded();
    const res = await patchAdjustment(request('PATCH', '/x', { token, body: { points: 8 } }), atAdj(adj.id));
    expect(res.status).toBe(200);
    expect((await readJson(res)).adjustment).toMatchObject({
      id: adj.id, teamKey: 'frc341', playerId: null, points: 8, reason: 'Award',
    });
  });

  it('switches the target from a team to a player', async () => {
    const adj = await seeded();
    const res = await patchAdjustment(
      request('PATCH', '/x', { token, body: { playerId: mom.id } }),
      atAdj(adj.id),
    );
    expect(res.status).toBe(200);
    expect(await repo.getAdjustment(adj.id)).toMatchObject({ playerId: mom.id, teamKey: null });
  });

  it('switches the target from a player to a team', async () => {
    const adj = await repo.insertAdjustment({
      roundId: round.id, playerId: mom.id, teamKey: null, points: 5, reason: 'x',
    });
    await patchAdjustment(request('PATCH', '/x', { token, body: { teamKey: 'frc25' } }), atAdj(adj.id));
    expect(await repo.getAdjustment(adj.id)).toMatchObject({ playerId: null, teamKey: 'frc25' });
  });

  it('answers 400 for both targets, bad values, unknown fields, or an empty patch', async () => {
    const adj = await seeded();
    const bodies = [
      { playerId: mom.id, teamKey: 'frc25' },
      { points: 1001 },
      { reason: '' },
      { roundId: 'x' },
      {},
    ];
    for (const body of bodies) {
      const res = await patchAdjustment(request('PATCH', '/x', { token, body }), atAdj(adj.id));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await repo.getAdjustment(adj.id)).toMatchObject({ teamKey: 'frc341', points: 5, reason: 'Award' });
  });

  it("answers 404 for an unknown id, a bad id, or another round's adjustment", async () => {
    const otherRound = await newRound(league.id, '2026parr');
    const elsewhere = await repo.insertAdjustment({
      roundId: otherRound.id, playerId: null, teamKey: 'frc1', points: 1, reason: 'x',
    });
    for (const id of ['3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b', 'nope', elsewhere.id]) {
      const res = await patchAdjustment(request('PATCH', '/x', { token, body: { points: 9 } }), atAdj(id));
      expect(res.status, id).toBe(404);
    }
    expect((await repo.getAdjustment(elsewhere.id))!.points).toBe(1);
  });
});

describe('DELETE adjustments/{adjId}', () => {
  it('deletes the adjustment', async () => {
    const adj = await repo.insertAdjustment({
      roundId: round.id, playerId: null, teamKey: 'frc341', points: 5, reason: 'Award',
    });
    const res = await deleteAdjustment(request('DELETE', '/x', { token }), atAdj(adj.id));
    expect(res.status).toBe(204);
    expect(await repo.listAdjustments(round.id)).toEqual([]);
  });

  it('answers 404 for an unknown id', async () => {
    const res = await deleteAdjustment(
      request('DELETE', '/x', { token }),
      atAdj('3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b'),
    );
    expect(res.status).toBe(404);
  });
});
