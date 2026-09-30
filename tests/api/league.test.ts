import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import { PATCH as patchLeague } from '@/app/api/l/[slug]/admin/league/route';
import { GET as getState } from '@/app/api/l/[slug]/admin/state/route';
import { GET as verify } from '@/app/api/l/[slug]/admin/verify/route';
import { POST as createLeague } from '@/app/api/leagues/route';
import { hashToken } from '@/lib/auth/commissioner';
import type { Repo } from '@/lib/db/repo';
import { DEFAULT_SCORING, defaultScoring } from '@/lib/scoring/config';
import { setUser, signInAsMember } from '../helpers/auth';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;

beforeEach(() => {
  setUser(null);
  repo = createMemoryRepo();
  h.repo = repo;
  vi.stubEnv('CREATE_LEAGUE_PASSCODE', 'open sesame');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/leagues', () => {
  it('creates a league and returns the token exactly once', async () => {
    const res = await createLeague(
      request('POST', '/api/leagues', { body: { name: 'Habich Fam', passcode: 'open sesame' } }),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.slug).toMatch(/^habich-fam-[a-z2-7]{6}$/);
    expect(body.adminToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const league = (await repo.getLeagueBySlug(body.slug))!;
    expect(league.name).toBe('Habich Fam');
    expect(league.adminTokenHash).toBe(hashToken(body.adminToken));
    expect(league.adminTokenHash).not.toContain(body.adminToken);
    expect(league.defaultScoring).toEqual(DEFAULT_SCORING);
  });

  it('answers 403 for a wrong passcode and creates nothing', async () => {
    const spy = vi.spyOn(repo, 'createLeague');
    const res = await createLeague(
      request('POST', '/api/leagues', { body: { name: 'Habich Fam', passcode: 'nope' } }),
    );
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it('answers 403 when the server has no passcode configured', async () => {
    vi.stubEnv('CREATE_LEAGUE_PASSCODE', '');
    const res = await createLeague(
      request('POST', '/api/leagues', { body: { name: 'Habich Fam', passcode: '' } }),
    );
    expect([400, 403]).toContain(res.status);
    expect(await repo.getLeagueBySlug('habich-fam')).toBeNull();
  });

  it('answers 400 for an empty or too-long name', async () => {
    for (const name of ['', '   ', 'x'.repeat(81)]) {
      const res = await createLeague(
        request('POST', '/api/leagues', { body: { name, passcode: 'open sesame' } }),
      );
      expect(res.status, JSON.stringify(name)).toBe(400);
    }
  });

  it('retries when the random slug is already taken', async () => {
    const real = repo.createLeague.bind(repo);
    let calls = 0;
    vi.spyOn(repo, 'createLeague').mockImplementation(async (input) => {
      calls += 1;
      if (calls === 1) {
        const { UniqueViolation } = await import('@/lib/db/repo');
        throw new UniqueViolation('leagues_slug_key');
      }
      return real(input);
    });
    const res = await createLeague(
      request('POST', '/api/leagues', { body: { name: 'Habich Fam', passcode: 'open sesame' } }),
    );
    expect(res.status).toBe(201);
    expect(calls).toBe(2);
  });
});

describe('GET /admin/verify', () => {
  it('answers 200 for the commissioner', async () => {
    const { league } = await seedLeague(repo);
    const res = await verify(request('GET', '/x', {}), params({ slug: league.slug }));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true });
  });

  it('answers 401 signed out and 403 for a member who is not a commissioner', async () => {
    const { league } = await seedLeague(repo);
    setUser(null);
    expect((await verify(request('GET', '/x'), params({ slug: league.slug }))).status).toBe(401);
    await signInAsMember(repo, league, 'Mom', 'player');
    expect((await verify(request('GET', '/x'), params({ slug: league.slug }))).status).toBe(403);
  });
});

describe('GET /admin/state', () => {
  it('returns the league, players, and rounds, and never the token hash', async () => {
    const { league, commissioner } = await seedLeague(repo);
    const mom = await repo.createPlayer(league.id, 'Mom');
    const dad = await repo.createPlayer(league.id, 'Dad');
    const round = await repo.createRound({
      leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
      startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
      scoring: defaultScoring(),
    });
    await repo.updateRound(round.id, { draftOrder: [mom.id], rosterSize: 2 });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc341' });

    const res = await getState(request('GET', '/x', {}), params({ slug: league.slug }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('adminTokenHash');

    const body = JSON.parse(text);
    expect(body.league).toEqual({
      slug: league.slug, name: 'Habich Fam', homeTeamNumber: 5181, defaultScoring: DEFAULT_SCORING,
    });
    expect(body.players).toEqual([
      { id: commissioner.id, name: 'Commish', inUse: false, role: 'commissioner', linked: true },
      { id: mom.id, name: 'Mom', inUse: true, role: 'player', linked: false },
      { id: dad.id, name: 'Dad', inUse: false, role: 'player', linked: false },
    ]);
    expect(body.rounds).toEqual([
      {
        id: round.id, eventKey: '2025parr', eventName: 'Ramp Riot',
        startDate: '2025-10-25', endDate: '2025-10-25',
        status: 'drafting', pickCount: 1, totalPicks: 2,
      },
    ]);
  });

  it('answers 401 signed out and 403 for a member who is not a commissioner', async () => {
    const { league } = await seedLeague(repo);
    setUser(null);
    expect((await getState(request('GET', '/x'), params({ slug: league.slug }))).status).toBe(401);
    await signInAsMember(repo, league, 'Mom', 'player');
    expect((await getState(request('GET', '/x'), params({ slug: league.slug }))).status).toBe(403);
  });
});

describe('PATCH /admin/league', () => {
  it('renames the league', async () => {
    const { league } = await seedLeague(repo);
    const res = await patchLeague(
      request('PATCH', '/x', { body: { name: '  Robot Fam  ' } }),
      params({ slug: league.slug }),
    );
    expect(res.status).toBe(200);
    expect((await readJson(res)).league.name).toBe('Robot Fam');
    expect((await repo.getLeagueBySlug(league.slug))!.name).toBe('Robot Fam');
  });

  it('updates the default scoring and home team', async () => {
    const { league } = await seedLeague(repo);
    const scoring = { ...defaultScoring(), qualWin: 2 };
    const res = await patchLeague(
      request('PATCH', '/x', { body: { defaultScoring: scoring, homeTeamNumber: 341 } }),
      params({ slug: league.slug }),
    );
    expect(res.status).toBe(200);
    const saved = (await repo.getLeagueBySlug(league.slug))!;
    expect(saved.defaultScoring.qualWin).toBe(2);
    expect(saved.homeTeamNumber).toBe(341);
  });

  it('does not change existing rounds when the league default changes (§3.5)', async () => {
    const { league } = await seedLeague(repo);
    const round = await repo.createRound({
      leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
      startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
      scoring: defaultScoring(),
    });
    await patchLeague(
      request('PATCH', '/x', { body: { defaultScoring: { ...defaultScoring(), qualWin: 2 } } }),
      params({ slug: league.slug }),
    );
    expect((await repo.getRound(round.id))!.scoring.qualWin).toBe(3);
  });

  it('answers 400 for invalid scoring, an empty patch, or unknown fields', async () => {
    const { league } = await seedLeague(repo);
    const bodies = [
      { defaultScoring: { ...defaultScoring(), qualWin: 1.5 } },
      {},
      { adminTokenHash: 'x' },
      { name: '' },
      { homeTeamNumber: 0 },
    ];
    for (const body of bodies) {
      const res = await patchLeague(request('PATCH', '/x', { body }), params({ slug: league.slug }));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('answers 401 signed out and 403 for a member who is not a commissioner, and changes nothing', async () => {
    const { league } = await seedLeague(repo);
    const attempt = () =>
      patchLeague(request('PATCH', '/x', { body: { name: 'Hacked' } }), params({ slug: league.slug }));
    setUser(null);
    expect((await attempt()).status).toBe(401);
    await signInAsMember(repo, league, 'Mom', 'player');
    const res = await attempt();
    expect(res.status).toBe(403);
    expect((await repo.getLeagueBySlug(league.slug))!.name).toBe('Habich Fam');
  });
});
