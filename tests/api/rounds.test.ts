import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import {
  DELETE as deleteRound,
  GET as getRound,
  PATCH as patchRound,
} from '@/app/api/l/[slug]/admin/rounds/[id]/route';
import { DELETE as removeTeam } from '@/app/api/l/[slug]/admin/rounds/[id]/teams/[teamKey]/route';
import { POST as addTeam } from '@/app/api/l/[slug]/admin/rounds/[id]/teams/route';
import { POST as addRound } from '@/app/api/l/[slug]/admin/rounds/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, PlayerRow, RoundRow } from '@/lib/db/types';
import { DEFAULT_SCORING, defaultScoring } from '@/lib/scoring/config';
import { setUser, signInAsMember } from '../helpers/auth';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;

const EVENT = {
  key: '2025parr',
  name: 'Ramp Riot',
  start_date: '2025-10-25',
  end_date: '2025-10-25',
  timezone: 'America/New_York',
  event_type: 99,
};

/** Six teams on TBA: frc1 .. frc6. */
const TBA_TEAMS = [1, 2, 3, 4, 5, 6].map((n) => ({ key: `frc${n}`, team_number: n, nickname: `Team ${n}` }));

function tbaAnswers(answers: Record<string, unknown>) {
  h.getTba = vi.fn(async (path: unknown) => {
    const data = answers[String(path)];
    return { data: data ?? null, fetchedAt: '2026-10-01T12:00:00.000Z', stale: false };
  });
}

beforeEach(async () => {
  setUser(null);
  repo = createMemoryRepo();
  h.repo = repo;
  ({ league } = await seedLeague(repo));
  tbaAnswers({ '/event/2025parr': EVENT, '/event/2025parr/teams/simple': TBA_TEAMS });
});

async function seedRound(): Promise<RoundRow> {
  return repo.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
    scoring: defaultScoring(),
  });
}

async function seedPlayers(...names: string[]): Promise<PlayerRow[]> {
  const out: PlayerRow[] = [];
  for (const name of names) out.push(await repo.createPlayer(league.id, name));
  return out;
}

const at = (round: RoundRow) => params({ slug: league.slug, id: round.id });

describe('POST /admin/rounds', () => {
  it('adds a round from a TBA event, copying the league scoring', async () => {
    await repo.updateLeague(league.id, { defaultScoring: { ...defaultScoring(), qualWin: 2 } });
    const res = await addRound(
      request('POST', '/x', { body: { eventKey: ' 2025PARR ' } }),
      params({ slug: league.slug }),
    );
    expect(res.status).toBe(201);
    const { round } = await readJson(res);
    expect(round).toMatchObject({
      eventKey: '2025parr', eventName: 'Ramp Riot', startDate: '2025-10-25', endDate: '2025-10-25',
    });
    const saved = (await repo.getRound(round.id))!;
    expect(saved.scoring.qualWin).toBe(2);
    expect(saved.timezone).toBe('America/New_York');
    expect(saved.rosterSize).toBe(4);
  });

  it('falls back to Eastern when TBA gives no timezone', async () => {
    tbaAnswers({ '/event/2025parr': { ...EVENT, timezone: null } });
    const res = await addRound(
      request('POST', '/x', { body: { eventKey: '2025parr' } }),
      params({ slug: league.slug }),
    );
    const { round } = await readJson(res);
    expect((await repo.getRound(round.id))!.timezone).toBe('America/New_York');
  });

  it('answers 404 when TBA has no such event', async () => {
    tbaAnswers({});
    const res = await addRound(
      request('POST', '/x', { body: { eventKey: '2026nope' } }),
      params({ slug: league.slug }),
    );
    expect(res.status).toBe(404);
    expect(await repo.listRounds(league.id)).toEqual([]);
  });

  it('answers 503 when TBA cannot be reached', async () => {
    h.getTba = vi.fn(async () => ({ data: null, fetchedAt: null, stale: true }));
    const res = await addRound(
      request('POST', '/x', { body: { eventKey: '2025parr' } }),
      params({ slug: league.slug }),
    );
    expect(res.status).toBe(503);
  });

  it('answers 409 when the event is already in the league', async () => {
    await seedRound();
    const res = await addRound(
      request('POST', '/x', { body: { eventKey: '2025parr' } }),
      params({ slug: league.slug }),
    );
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('That event is already in this league');
  });

  it('answers 400 for a malformed event key without calling TBA', async () => {
    for (const eventKey of ['parr', '2025 parr', '', 'https://tba/2025parr']) {
      const res = await addRound(
        request('POST', '/x', { body: { eventKey } }),
        params({ slug: league.slug }),
      );
      expect(res.status, eventKey).toBe(400);
    }
    expect(h.getTba).not.toHaveBeenCalled();
  });

  it('answers 401 signed out and 403 for a member who is not a commissioner', async () => {
    setUser(null);
    const signedOut = await addRound(request('POST', '/x', { body: { eventKey: '2025parr' } }), params({ slug: league.slug }));
    expect(signedOut.status).toBe(401);

    await signInAsMember(repo, league, 'Mom', 'player');
    const member = await addRound(request('POST', '/x', { body: { eventKey: '2025parr' } }), params({ slug: league.slug }));
    expect(member.status).toBe(403);
    expect(await repo.listRounds(league.id)).toEqual([]);
  });
});

describe('GET /admin/rounds/{id}', () => {
  it('returns the round with its pool, players, picks, and adjustments', async () => {
    const round = await seedRound();
    const [mom, dad] = await seedPlayers('Mom', 'Dad');
    await repo.updateRound(round.id, { draftOrder: [mom.id, dad.id], rosterSize: 2 });
    await repo.addExtraTeam(round.id, 'frc9999');
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc1' });
    await repo.insertAdjustment({ roundId: round.id, playerId: null, teamKey: 'frc1', points: 5, reason: 'Award' });

    const res = await getRound(request('GET', '/x', {}), at(round));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.round).toMatchObject({ id: round.id, rosterSize: 2, draftOrder: [mom.id, dad.id] });
    expect(body.round.scoring).toEqual(DEFAULT_SCORING);
    expect(body.status).toBe('drafting');
    expect(body.pool.map((t: { teamKey: string }) => t.teamKey)).toEqual([
      'frc1', 'frc2', 'frc3', 'frc4', 'frc5', 'frc6', 'frc9999',
    ]);
    expect(body.pool.at(-1)).toEqual({ teamKey: 'frc9999', label: '9999', nickname: null, manual: true });
    expect(body.poolStale).toBe(false);
    expect(body.players.map((p: { name: string }) => p.name)).toEqual(['Commish', 'Mom', 'Dad']);
    expect(body.picks).toEqual([{ pickNumber: 0, playerId: mom.id, teamKey: 'frc1' }]);
    expect(body.adjustments).toHaveLength(1);
    expect(body.maxRosterSize).toBe(3); // 7 teams / 2 players
  });

  it("answers 404 when league A's commissioner asks for league B's round", async () => {
    const other = await seedLeague(repo, { slug: 'other-league-bbbbbb', signIn: false });
    const theirs = await repo.createRound({
      leagueId: other.league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
      startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
      scoring: defaultScoring(),
    });
    const res = await getRound(request('GET', '/x', {}), params({ slug: league.slug, id: theirs.id }));
    expect(res.status).toBe(404);
  });

  it('answers 404 for an id that is not a UUID', async () => {
    const res = await getRound(request('GET', '/x', {}), params({ slug: league.slug, id: 'abc' }));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /admin/rounds/{id}', () => {
  it('sets the draft order and roster size', async () => {
    const round = await seedRound();
    const [mom, dad] = await seedPlayers('Mom', 'Dad');
    const res = await patchRound(
      request('PATCH', '/x', { body: { draftOrder: [dad.id, mom.id], rosterSize: 3 } }),
      at(round),
    );
    expect(res.status).toBe(200);
    expect((await readJson(res)).round).toMatchObject({ draftOrder: [dad.id, mom.id], rosterSize: 3 });
    expect((await repo.getRound(round.id))!.draftOrder).toEqual([dad.id, mom.id]);
  });

  it('answers 400 when players x roster size is more than the pool, and says the maximum', async () => {
    const round = await seedRound();
    const [mom, dad] = await seedPlayers('Mom', 'Dad');
    const res = await patchRound(
      request('PATCH', '/x', { body: { draftOrder: [mom.id, dad.id], rosterSize: 4 } }), // 8 > 6
      at(round),
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe('With 2 players and 6 teams, roster size can be at most 3');
    expect((await repo.getRound(round.id))!.draftOrder).toEqual([]);
  });

  it('counts manually added teams toward the pool size', async () => {
    const round = await seedRound();
    const [mom, dad] = await seedPlayers('Mom', 'Dad');
    await repo.addExtraTeam(round.id, 'frc9998');
    await repo.addExtraTeam(round.id, 'frc9999');
    const res = await patchRound(
      request('PATCH', '/x', { body: { draftOrder: [mom.id, dad.id], rosterSize: 4 } }), // 8 <= 8
      at(round),
    );
    expect(res.status).toBe(200);
  });

  it('answers 400 when the pool is too small for even one team each', async () => {
    tbaAnswers({ '/event/2025parr/teams/simple': null });
    const round = await seedRound();
    const [mom] = await seedPlayers('Mom');
    const res = await patchRound(
      request('PATCH', '/x', { body: { draftOrder: [mom.id], rosterSize: 1 } }),
      at(round),
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toMatch(/add teams/i);
  });

  it('answers 503 (not "add teams") when TBA could not be reached for the team list', async () => {
    h.getTba = vi.fn(async () => ({ data: null, fetchedAt: null, stale: true }));
    const round = await seedRound();
    const [mom] = await seedPlayers('Mom');
    const res = await patchRound(
      request('PATCH', '/x', { body: { draftOrder: [mom.id], rosterSize: 1 } }),
      at(round),
    );
    expect(res.status).toBe(503);
    expect((await readJson(res)).error).toBe(
      "Couldn't reach The Blue Alliance for the team list. Try again in a minute.",
    );
    expect((await repo.getRound(round.id))!.draftOrder).toEqual([]);
  });

  it('answers 400 for a draft order with duplicates or non-players', async () => {
    const round = await seedRound();
    const [mom] = await seedPlayers('Mom');
    const other = await seedLeague(repo, { slug: 'other-league-bbbbbb', signIn: false });
    const stranger = await repo.createPlayer(other.league.id, 'Stranger');
    const orders = [[mom.id, mom.id], [stranger.id], ['3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b'], ['not-a-uuid']];
    for (const draftOrder of orders) {
      const res = await patchRound(request('PATCH', '/x', { body: { draftOrder } }), at(round));
      expect(res.status, JSON.stringify(draftOrder)).toBe(400);
    }
  });

  it('answers 409 when changing draft order or roster size after a pick exists', async () => {
    const round = await seedRound();
    const [mom, dad] = await seedPlayers('Mom', 'Dad');
    await repo.updateRound(round.id, { draftOrder: [mom.id, dad.id], rosterSize: 2 });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc1' });

    for (const body of [{ draftOrder: [dad.id, mom.id] }, { rosterSize: 3 }]) {
      const res = await patchRound(request('PATCH', '/x', { body }), at(round));
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect((await readJson(res)).error).toMatch(/undo all picks/i);
    }
    expect((await repo.getRound(round.id))!).toMatchObject({ draftOrder: [mom.id, dad.id], rosterSize: 2 });
  });

  it('allows re-sending the same draft order and roster size after picks exist', async () => {
    const round = await seedRound();
    const [mom] = await seedPlayers('Mom');
    await repo.updateRound(round.id, { draftOrder: [mom.id], rosterSize: 2 });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc1' });
    const res = await patchRound(
      request('PATCH', '/x', { body: { draftOrder: [mom.id], rosterSize: 2 } }),
      at(round),
    );
    expect(res.status).toBe(200);
  });

  it('allows a scoring change after picks exist, and only for this round', async () => {
    const round = await seedRound();
    const [mom] = await seedPlayers('Mom');
    await repo.updateRound(round.id, { draftOrder: [mom.id], rosterSize: 2 });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc1' });
    const res = await patchRound(
      request('PATCH', '/x', { body: { scoring: { ...defaultScoring(), qualWin: 1 } } }),
      at(round),
    );
    expect(res.status).toBe(200);
    expect((await repo.getRound(round.id))!.scoring.qualWin).toBe(1);
    expect((await repo.getLeagueBySlug(league.slug))!.defaultScoring.qualWin).toBe(3);
  });

  it('marks a round final and reopens it', async () => {
    const round = await seedRound();
    const res1 = await patchRound(request('PATCH', '/x', { body: { finalized: true } }), at(round));
    expect((await readJson(res1)).status).toBe('final');
    expect((await repo.getRound(round.id))!.finalizedAt).not.toBeNull();

    const res2 = await patchRound(request('PATCH', '/x', { body: { finalized: false } }), at(round));
    expect((await readJson(res2)).status).toBe('setup');
    expect((await repo.getRound(round.id))!.finalizedAt).toBeNull();
  });

  it('leaves other fields alone when only one is patched', async () => {
    const round = await seedRound();
    const [mom] = await seedPlayers('Mom');
    await repo.updateRound(round.id, { draftOrder: [mom.id], rosterSize: 2 });
    await patchRound(request('PATCH', '/x', { body: { finalized: true } }), at(round));
    expect((await repo.getRound(round.id))!).toMatchObject({ draftOrder: [mom.id], rosterSize: 2 });
    expect((await repo.getRound(round.id))!.scoring).toEqual(DEFAULT_SCORING);
  });

  it('answers 400 for bad values, unknown fields, or an empty patch', async () => {
    const round = await seedRound();
    const bodies = [{ rosterSize: 0 }, { rosterSize: 11 }, { rosterSize: 2.5 }, { eventKey: '2026parr' }, {}];
    for (const body of bodies) {
      const res = await patchRound(request('PATCH', '/x', { body }), at(round));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe('DELETE /admin/rounds/{id}', () => {
  it('deletes the round with its picks and adjustments', async () => {
    const round = await seedRound();
    const [mom] = await seedPlayers('Mom');
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc1' });
    const res = await deleteRound(request('DELETE', '/x', {}), at(round));
    expect(res.status).toBe(204);
    expect(await repo.getRound(round.id)).toBeNull();
    expect(await repo.listPicks(round.id)).toEqual([]);
  });

  it('answers 401 signed out and 403 for a member, and deletes nothing', async () => {
    const round = await seedRound();
    setUser(null);
    expect((await deleteRound(request('DELETE', '/x'), at(round))).status).toBe(401);
    await signInAsMember(repo, league, 'Mom', 'player');
    const res = await deleteRound(request('DELETE', '/x'), at(round));
    expect(res.status).toBe(403);
    expect(await repo.getRound(round.id)).not.toBeNull();
  });
});

describe('team pool endpoints', () => {
  it('adds a manual team from human input', async () => {
    const round = await seedRound();
    for (const [input, key] of [['341b', 'frc341B'], [9999, 'frc9999'], [' frc25 ', 'frc25']] as const) {
      const res = await addTeam(request('POST', '/x', { body: { teamNumber: input } }), at(round));
      expect(res.status, String(input)).toBe(201);
      expect((await readJson(res)).teamKey).toBe(key);
    }
    expect((await repo.listExtraTeams(round.id)).sort()).toEqual(['frc25', 'frc341B', 'frc9999']);
  });

  it('answers 400 for junk team numbers', async () => {
    const round = await seedRound();
    for (const teamNumber of ['', '0', '34a1', '123456', 'abc', -5, 3.5, null]) {
      const res = await addTeam(request('POST', '/x', { body: { teamNumber } }), at(round));
      expect(res.status, String(teamNumber)).toBe(400);
    }
    expect(await repo.listExtraTeams(round.id)).toEqual([]);
  });

  it('removes a manual team that nobody drafted', async () => {
    const round = await seedRound();
    await repo.addExtraTeam(round.id, 'frc9999');
    const res = await removeTeam(
      request('DELETE', '/x', {}),
      params({ slug: league.slug, id: round.id, teamKey: 'frc9999' }),
    );
    expect(res.status).toBe(204);
    expect(await repo.listExtraTeams(round.id)).toEqual([]);
  });

  it('answers 409 when removing a team that has been drafted', async () => {
    const round = await seedRound();
    const [mom] = await seedPlayers('Mom');
    await repo.addExtraTeam(round.id, 'frc9999');
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc9999' });
    const res = await removeTeam(
      request('DELETE', '/x', {}),
      params({ slug: league.slug, id: round.id, teamKey: 'frc9999' }),
    );
    expect(res.status).toBe(409);
    expect(await repo.listExtraTeams(round.id)).toEqual(['frc9999']);
  });

  it('answers 409 when removing a manual team would leave fewer teams than picks', async () => {
    const round = await seedRound();
    const [mom, dad] = await seedPlayers('Mom', 'Dad');
    await repo.addExtraTeam(round.id, 'frc9998');
    await repo.addExtraTeam(round.id, 'frc9999');
    await repo.updateRound(round.id, { draftOrder: [mom.id, dad.id], rosterSize: 4 }); // 8 picks, pool 8
    const res = await removeTeam(
      request('DELETE', '/x', {}),
      params({ slug: league.slug, id: round.id, teamKey: 'frc9999' }),
    );
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toMatch(/lower the roster size/i);
    expect((await repo.listExtraTeams(round.id)).sort()).toEqual(['frc9998', 'frc9999']);
  });

  it('answers 400 for a malformed team key in the URL', async () => {
    const round = await seedRound();
    const res = await removeTeam(
      request('DELETE', '/x', {}),
      params({ slug: league.slug, id: round.id, teamKey: 'nope' }),
    );
    expect(res.status).toBe(400);
  });
});
