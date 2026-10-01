import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
// SP1's session mock: choose who is signed in with setUser().
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);

import { GET } from '@/app/api/l/[slug]/rounds/[id]/pool/[teamKey]/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { setUser, signInAsMember } from '../helpers/auth';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;
let round: RoundRow;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  ({ league } = await seedLeague(repo, { signIn: false })); // tests start signed out
  setUser(null);
  round = await repo.createRound({
    leagueId: league.id, eventKey: '2026parr', eventName: 'Ramp Riot', startDate: '2026-10-24',
    endDate: '2026-10-24', timezone: 'America/New_York', scoring: defaultScoring(),
  });
  await repo.upsertTeamStats([{
    teamKey: 'frc341', season: 2026, eventsPlayed: 2, totalPoints: 80, qualWins: 12, qualLosses: 4, qualTies: 0,
    bestFinish: 'winner', awards: [{ type: 0, name: 'Impact', eventKey: '2026paca' }],
    events: [{ eventKey: '2026paca', name: 'Greater Pittsburgh', endDate: '2026-03-08', rank: 1, finish: 'winner', points: 50 }],
    latestEventKey: '2026paca', latestOpr: 55.5, latestRank: 1, updatedAt: '2026-10-01T00:00:00.000Z',
  }]);
});

const get = (teamKey: string, slug = league.slug, id = round.id) =>
  GET(request('GET', '/x'), params({ slug, id, teamKey }));

describe('GET …/pool/{teamKey}', () => {
  it('returns the history of a link-visible league to anyone, even signed out', async () => {
    const res = await get('frc341');
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.season).toBe(2026);
    expect(body.proj).toBe(40);
    expect(body.seasons[0].events[0].eventKey).toBe('2026paca');
    expect(body.seasons[0].awards[0].name).toBe('Impact');
  });

  it('returns an empty history (proj null) for a New team', async () => {
    const body = await readJson(await get('frc9999'));
    expect(body).toEqual({ teamKey: 'frc9999', season: 2026, proj: null, seasons: [] });
  });

  it('is 403 for non-members of a members-only league, 200 for members', async () => {
    await repo.updateLeague(league.id, { visibility: 'members' });
    expect((await get('frc341')).status).toBe(403);
    setUser({ id: 'stranger', email: null });
    expect((await get('frc341')).status).toBe(403);
    await signInAsMember(repo, league, 'Mom');
    expect((await get('frc341')).status).toBe(200);
  });

  it.each([
    ['a junk team key', () => get('341')],
    ['an unknown league', () => get('frc341', 'no-such-league')],
    ['a non-UUID round id', () => get('frc341', league.slug, 'not-a-uuid')],
    ['an unknown round', () => get('frc341', league.slug, '00000000-0000-4000-8000-000000000009')],
  ])('is 404 for %s', async (_label, call) => {
    expect((await call()).status).toBe(404);
  });
});
