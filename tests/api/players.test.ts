import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import { DELETE as deletePlayer, PATCH as renamePlayer } from '@/app/api/l/[slug]/admin/players/[id]/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { setUser, signInAsMember } from '../helpers/auth';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;

beforeEach(async () => {
  setUser(null);
  repo = createMemoryRepo();
  h.repo = repo;
  ({ league } = await seedLeague(repo));
});

async function addRound() {
  return repo.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
    scoring: defaultScoring(),
  });
}

describe('PATCH /admin/players/{id}', () => {
  it('renames a player', async () => {
    const mom = await repo.createPlayer(league.id, 'Mom');
    const res = await renamePlayer(
      request('PATCH', '/x', { body: { name: 'Mother' } }),
      params({ slug: league.slug, id: mom.id }),
    );
    expect(res.status).toBe(200);
    expect((await readJson(res)).player.name).toBe('Mother');
  });

  it('lets a player change only the capitalization of their own name', async () => {
    const mom = await repo.createPlayer(league.id, 'mom');
    const res = await renamePlayer(
      request('PATCH', '/x', { body: { name: 'Mom' } }),
      params({ slug: league.slug, id: mom.id }),
    );
    expect(res.status).toBe(200);
  });

  it('answers 409 when the new name belongs to someone else', async () => {
    await repo.createPlayer(league.id, 'Mom');
    const dad = await repo.createPlayer(league.id, 'Dad');
    const res = await renamePlayer(
      request('PATCH', '/x', { body: { name: 'MOM' } }),
      params({ slug: league.slug, id: dad.id }),
    );
    expect(res.status).toBe(409);
  });

  it("answers 404 for an unknown id, a bad id, or another league's player", async () => {
    const other = await seedLeague(repo, { slug: 'other-league-bbbbbb', signIn: false });
    const stranger = await repo.createPlayer(other.league.id, 'Stranger');
    for (const id of ['3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b', 'not-a-uuid', stranger.id]) {
      const res = await renamePlayer(
        request('PATCH', '/x', { body: { name: 'Hacked' } }),
        params({ slug: league.slug, id }),
      );
      expect(res.status, id).toBe(404);
    }
    expect((await repo.listPlayers(other.league.id)).find((p) => p.name === 'Stranger')).toBeDefined();
  });
});

describe('DELETE /admin/players/{id}', () => {
  it('answers 401 signed out and 403 for a member who is not a commissioner', async () => {
    const mom = await repo.createPlayer(league.id, 'Mom');
    const attempt = () => deletePlayer(request('DELETE', '/x'), params({ slug: league.slug, id: mom.id }));
    setUser(null);
    expect((await attempt()).status).toBe(401);
    await signInAsMember(repo, league, 'Sis', 'player');
    expect((await attempt()).status).toBe(403);
    expect(await repo.listPlayers(league.id)).toHaveLength(3);
  });

  it('removes a player who is not in use', async () => {
    const mom = await repo.createPlayer(league.id, 'Mom');
    const res = await deletePlayer(request('DELETE', '/x', {}), params({ slug: league.slug, id: mom.id }));
    expect(res.status).toBe(204);
    expect((await repo.listPlayers(league.id)).map((p) => p.name)).toEqual(['Commish']);
  });

  it('answers 409 for a player who is in a draft order', async () => {
    const mom = await repo.createPlayer(league.id, 'Mom');
    const round = await addRound();
    await repo.updateRound(round.id, { draftOrder: [mom.id] });
    const res = await deletePlayer(request('DELETE', '/x', {}), params({ slug: league.slug, id: mom.id }));
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toMatch(/rename/i);
    expect(await repo.listPlayers(league.id)).toHaveLength(2);
  });

  it('answers 409 for a player who has an adjustment', async () => {
    const mom = await repo.createPlayer(league.id, 'Mom');
    const round = await addRound();
    await repo.insertAdjustment({ roundId: round.id, playerId: mom.id, teamKey: null, points: 5, reason: 'x' });
    const res = await deletePlayer(request('DELETE', '/x', {}), params({ slug: league.slug, id: mom.id }));
    expect(res.status).toBe(409);
  });

  it("answers 404 for another league's player and leaves them alone", async () => {
    const other = await seedLeague(repo, { slug: 'other-league-bbbbbb', signIn: false });
    const stranger = await repo.createPlayer(other.league.id, 'Stranger');
    const res = await deletePlayer(
      request('DELETE', '/x', {}),
      params({ slug: league.slug, id: stranger.id }),
    );
    expect(res.status).toBe(404);
    expect(await repo.listPlayers(other.league.id)).toHaveLength(2);
  });
});
