import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);

import { POST as leave } from '@/app/api/l/[slug]/me/leave/route';
import { PATCH as renameMe } from '@/app/api/l/[slug]/me/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { LAST_COMMISSIONER_MESSAGE } from '@/lib/leagues/membership';
import { setUser, signInAsMember } from '../helpers/auth';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;
const here = () => params({ slug: league.slug });

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  ({ league } = await seedLeague(repo));
});

describe('PATCH /api/l/{slug}/me (rename myself)', () => {
  it('renames the signed-in member only', async () => {
    const { player } = await signInAsMember(repo, league, 'Mom');
    const res = await renameMe(request('PATCH', '/x', { body: { name: ' Mother ' } }), here());
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ player: { id: player.id, name: 'Mother' } });
  });
  it('answers 409 for a name someone else has', async () => {
    await signInAsMember(repo, league, 'Mom');
    const res = await renameMe(request('PATCH', '/x', { body: { name: 'commish' } }), here());
    expect(res.status).toBe(409);
  });
  it('answers 401 signed out and 403 for a non-member', async () => {
    setUser(null);
    expect((await renameMe(request('PATCH', '/x', { body: { name: 'X' } }), here())).status).toBe(401);
    const other = await seedLeague(repo, { slug: 'other-bbbbbb' }); // signed in as other's commissioner
    expect((await renameMe(request('PATCH', '/x', { body: { name: 'X' } }), here())).status).toBe(403);
    expect(other.league.id).not.toBe(league.id);
  });
});

describe('POST /api/l/{slug}/me/leave', () => {
  it('deletes a member with no history', async () => {
    const { player } = await signInAsMember(repo, league, 'Mom');
    const res = await leave(request('POST', '/x'), here());
    expect(await readJson(res)).toEqual({ result: 'deleted' });
    expect((await repo.listPlayers(league.id)).some((p) => p.id === player.id)).toBe(false);
  });
  it('unlinks a member with picks', async () => {
    const { player } = await signInAsMember(repo, league, 'Mom');
    const round = await repo.createRound({
      leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot', startDate: '2025-10-25',
      endDate: '2025-10-25', timezone: 'America/New_York', scoring: league.defaultScoring,
    });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: player.id, teamKey: 'frc341' });
    expect(await readJson(await leave(request('POST', '/x'), here()))).toEqual({ result: 'unlinked' });
  });
  it('refuses to let the last commissioner leave', async () => {
    const res = await leave(request('POST', '/x'), here()); // signed in as Commish
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe(LAST_COMMISSIONER_MESSAGE);
  });
});
