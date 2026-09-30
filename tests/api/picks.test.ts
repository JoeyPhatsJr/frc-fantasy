import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import {
  DELETE as undoPick,
  PATCH as replacePick,
} from '@/app/api/l/[slug]/admin/rounds/[id]/picks/[pickNumber]/route';
import { POST as addPick } from '@/app/api/l/[slug]/admin/rounds/[id]/picks/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, PlayerRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { setUser, signInAsMember } from '../helpers/auth';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;
let round: RoundRow;
let mom: PlayerRow;
let dad: PlayerRow;

const TBA_TEAMS = [1, 2, 3, 4, 5, 6].map((n) => ({ key: `frc${n}`, team_number: n, nickname: `Team ${n}` }));

beforeEach(async () => {
  setUser(null);
  repo = createMemoryRepo();
  h.repo = repo;
  h.getTba = vi.fn(async () => ({ data: TBA_TEAMS, fetchedAt: '2026-10-01T12:00:00.000Z', stale: false }));
  ({ league } = await seedLeague(repo));
  mom = await repo.createPlayer(league.id, 'Mom');
  dad = await repo.createPlayer(league.id, 'Dad');
  round = await repo.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
    scoring: defaultScoring(),
  });
  round = await repo.updateRound(round.id, { draftOrder: [mom.id, dad.id], rosterSize: 2 });
});

const here = () => params({ slug: league.slug, id: round.id });
const atPick = (pickNumber: number | string) =>
  params({ slug: league.slug, id: round.id, pickNumber: String(pickNumber) });

function pick(expectedPickNumber: number, teamKey: string) {
  return addPick(request('POST', '/x', { body: { expectedPickNumber, teamKey } }), here());
}

describe('POST picks', () => {
  it('records picks in snake order: Mom, Dad, Dad, Mom', async () => {
    const teams = ['frc1', 'frc2', 'frc3', 'frc4'];
    for (let n = 0; n < teams.length; n++) {
      const res = await pick(n, teams[n]);
      expect(res.status, `pick ${n}`).toBe(201);
    }
    const saved = await repo.listPicks(round.id);
    expect(saved.map((p) => [p.pickNumber, p.playerId, p.teamKey])).toEqual([
      [0, mom.id, 'frc1'],
      [1, dad.id, 'frc2'],
      [2, dad.id, 'frc3'],
      [3, mom.id, 'frc4'],
    ]);
  });

  it('returns the pick it recorded', async () => {
    const res = await pick(0, 'frc1');
    expect(await readJson(res)).toEqual({ pick: { pickNumber: 0, playerId: mom.id, teamKey: 'frc1' } });
  });

  it('answers 409 for the wrong expected pick number', async () => {
    await pick(0, 'frc1');
    for (const n of [0, 2]) {
      const res = await pick(n, 'frc2');
      expect(res.status, `expected ${n}`).toBe(409);
      expect((await readJson(res)).error).toBe('Draft changed in another tab — refresh');
    }
    expect(await repo.listPicks(round.id)).toHaveLength(1);
  });

  it('answers 409 when the team is already taken', async () => {
    await pick(0, 'frc1');
    const res = await pick(1, 'frc1');
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('That team was just taken');
  });

  it('answers 409 when two tabs pick at the same moment (race)', async () => {
    // Both requests read "no picks yet", then both try to insert pick 0.
    vi.spyOn(repo, 'listPicks').mockResolvedValue([]);
    expect((await pick(0, 'frc1')).status).toBe(201);
    const second = await pick(0, 'frc2');
    expect(second.status).toBe(409);
    expect((await readJson(second)).error).toBe('Draft changed in another tab — refresh');
  });

  it('answers 409 when the draft is full', async () => {
    const teams = ['frc1', 'frc2', 'frc3', 'frc4'];
    for (let n = 0; n < teams.length; n++) await pick(n, teams[n]);
    const res = await pick(4, 'frc5');
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('The draft is full');
  });

  it('answers 409 when there is no draft order yet', async () => {
    await repo.updateRound(round.id, { draftOrder: [] });
    const res = await pick(0, 'frc1');
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toMatch(/draft order/i);
  });

  it('answers 400 for a team that is not in the pool', async () => {
    const res = await pick(0, 'frc9999');
    expect(res.status).toBe(400);
    expect(await repo.listPicks(round.id)).toEqual([]);
  });

  it('accepts a manually added team', async () => {
    await repo.addExtraTeam(round.id, 'frc341B');
    expect((await pick(0, 'frc341B')).status).toBe(201);
  });

  it('answers 400 for malformed input', async () => {
    const bodies = [
      { expectedPickNumber: 0, teamKey: '341' },
      { expectedPickNumber: -1, teamKey: 'frc1' },
      { expectedPickNumber: 0.5, teamKey: 'frc1' },
      { teamKey: 'frc1' },
      { expectedPickNumber: 0 },
    ];
    for (const body of bodies) {
      const res = await addPick(request('POST', '/x', { body }), here());
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('answers 401 signed out and 403 for a member who is not a commissioner', async () => {
    setUser(null);
    expect((await pick(0, 'frc1')).status).toBe(401);

    await signInAsMember(repo, league, 'Sis', 'player');
    expect((await pick(0, 'frc1')).status).toBe(403);
    expect(await repo.listPicks(round.id)).toEqual([]);
  });

  it("answers 403 when another league's commissioner tries to pick here", async () => {
    const other = await seedLeague(repo, { slug: 'other-league-bbbbbb' }); // signs in as other's commissioner
    const res = await pick(0, 'frc1');
    expect(res.status).toBe(403);
    expect(await repo.listPicks(round.id)).toEqual([]);
    setUser(other.user);
  });
});

describe('DELETE picks/{pickNumber} (undo)', () => {
  it('undoes the last pick', async () => {
    await pick(0, 'frc1');
    await pick(1, 'frc2');
    const res = await undoPick(request('DELETE', '/x', {}), atPick(1));
    expect(res.status).toBe(204);
    expect((await repo.listPicks(round.id)).map((p) => p.teamKey)).toEqual(['frc1']);
  });

  it('frees the team to be picked again', async () => {
    await pick(0, 'frc1');
    await undoPick(request('DELETE', '/x', {}), atPick(0));
    expect((await pick(0, 'frc1')).status).toBe(201);
  });

  it('answers 409 for any pick that is not the last one', async () => {
    await pick(0, 'frc1');
    await pick(1, 'frc2');
    for (const n of [0, 2, 'abc', '-1', '1.5']) {
      const res = await undoPick(request('DELETE', '/x', {}), atPick(n));
      expect(res.status, String(n)).toBe(409);
    }
    expect(await repo.listPicks(round.id)).toHaveLength(2);
  });

  it('answers 409 when there is nothing to undo', async () => {
    const res = await undoPick(request('DELETE', '/x', {}), atPick(0));
    expect(res.status).toBe(409);
  });
});

describe('PATCH picks/{pickNumber} (replace)', () => {
  it('changes the team without changing the order or the player', async () => {
    await pick(0, 'frc1');
    await pick(1, 'frc2');
    const res = await replacePick(request('PATCH', '/x', { body: { teamKey: 'frc6' } }), atPick(0));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ pick: { pickNumber: 0, playerId: mom.id, teamKey: 'frc6' } });
    expect((await repo.listPicks(round.id)).map((p) => [p.pickNumber, p.playerId, p.teamKey])).toEqual([
      [0, mom.id, 'frc6'],
      [1, dad.id, 'frc2'],
    ]);
  });

  it('answers 409 when the new team is taken', async () => {
    await pick(0, 'frc1');
    await pick(1, 'frc2');
    const res = await replacePick(request('PATCH', '/x', { body: { teamKey: 'frc2' } }), atPick(0));
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('That team was just taken');
  });

  it('is a harmless no-op when the team is unchanged', async () => {
    await pick(0, 'frc1');
    const res = await replacePick(request('PATCH', '/x', { body: { teamKey: 'frc1' } }), atPick(0));
    expect(res.status).toBe(200);
  });

  it('answers 400 for a team outside the pool', async () => {
    await pick(0, 'frc1');
    const res = await replacePick(request('PATCH', '/x', { body: { teamKey: 'frc9999' } }), atPick(0));
    expect(res.status).toBe(400);
  });

  it('answers 404 for a pick that does not exist', async () => {
    for (const n of [0, 'abc']) {
      const res = await replacePick(request('PATCH', '/x', { body: { teamKey: 'frc1' } }), atPick(n));
      expect(res.status, String(n)).toBe(404);
    }
  });
});
