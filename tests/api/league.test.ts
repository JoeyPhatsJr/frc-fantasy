import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import { DELETE as deleteLeague, PATCH as patchLeague } from '@/app/api/l/[slug]/admin/league/route';
import { GET as getState } from '@/app/api/l/[slug]/admin/state/route';
import { GET as verify } from '@/app/api/l/[slug]/admin/verify/route';
import { POST as resetInvite } from '@/app/api/l/[slug]/admin/invite/route';
import { POST as createLeague } from '@/app/api/leagues/route';
import type { Repo } from '@/lib/db/repo';
import { DEFAULT_SCORING, defaultScoring } from '@/lib/scoring/config';
import { makeUser, setUser, signInAsMember } from '../helpers/auth';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;

beforeEach(() => {
  setUser(null);
  repo = createMemoryRepo();
  h.repo = repo;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/leagues (spec §4.4)', () => {
  it('creates a league with an invite code and makes the creator its commissioner', async () => {
    const user = await makeUser(repo, 'Joey');
    setUser(user);
    const res = await createLeague(request('POST', '/api/leagues', { body: { name: '  Habich Fam ' } }));
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.slug).toMatch(/^habich-fam-[a-z2-7]{6}$/);
    expect(body.inviteCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);

    const league = (await repo.getLeagueBySlug(body.slug))!;
    expect(league).toMatchObject({ name: 'Habich Fam', visibility: 'link', createdBy: user.id, adminTokenHash: null });
    expect(league.defaultScoring).toEqual(DEFAULT_SCORING);
    const [me] = await repo.listPlayers(league.id);
    expect(me).toMatchObject({ name: 'Joey', userId: user.id, role: 'commissioner' });
  });

  it('honours visibility', async () => {
    setUser(await makeUser(repo, 'Joey'));
    const res = await createLeague(request('POST', '/api/leagues', { body: { name: 'Secret', visibility: 'members' } }));
    const { slug } = await readJson(res);
    expect((await repo.getLeagueBySlug(slug))!.visibility).toBe('members');
  });

  it('answers 401 signed out and creates nothing', async () => {
    setUser(null);
    const spy = vi.spyOn(repo, 'createLeague');
    const res = await createLeague(request('POST', '/api/leagues', { body: { name: 'Fam' } }));
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('stops at 5 created leagues', async () => {
    setUser(await makeUser(repo, 'Joey'));
    for (let i = 0; i < 5; i++) {
      expect((await createLeague(request('POST', '/api/leagues', { body: { name: `L${i}` } }))).status).toBe(201);
    }
    const res = await createLeague(request('POST', '/api/leagues', { body: { name: 'One too many' } }));
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe("You've reached the 5-league limit");
  });

  it('answers 400 for a bad name or visibility', async () => {
    setUser(await makeUser(repo, 'Joey'));
    for (const body of [{ name: '' }, { name: 'x'.repeat(81) }, { name: 'ok', visibility: 'public' }, {}]) {
      expect((await createLeague(request('POST', '/api/leagues', { body }))).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('retries on a slug or invite-code clash, but not on other unique violations', async () => {
    setUser(await makeUser(repo, 'Joey'));
    const { UniqueViolation } = await import('@/lib/db/repo');
    const real = repo.createLeague.bind(repo);
    let calls = 0;
    vi.spyOn(repo, 'createLeague').mockImplementation(async (input) => {
      calls += 1;
      if (calls === 1) throw new UniqueViolation('leagues_slug_key');
      if (calls === 2) throw new UniqueViolation('leagues_invite_code_key');
      return real(input);
    });
    const res = await createLeague(request('POST', '/api/leagues', { body: { name: 'Fam' } }));
    expect(res.status).toBe(201);
    expect(calls).toBe(3);

    calls = 0;
    vi.spyOn(repo, 'createLeague').mockImplementation(async () => {
      calls += 1;
      throw new UniqueViolation('something_else_key');
    });
    const bad = await createLeague(request('POST', '/api/leagues', { body: { name: 'Fam2' } }));
    expect(bad.status).not.toBe(201);
    expect(calls).toBe(1);
  });

  it('removes the league if the commissioner membership cannot be created', async () => {
    const user = await makeUser(repo, 'Joey');
    setUser(user);
    vi.spyOn(repo, 'createMember').mockRejectedValueOnce(new Error('boom'));
    const res = await createLeague(request('POST', '/api/leagues', { body: { name: 'Fam' } }));
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await repo.countLeaguesCreatedBy(user.id)).toBe(0);
  });
});

describe('PATCH /admin/league visibility', () => {
  it('switches between link and members', async () => {
    const { league } = await seedLeague(repo);
    const res = await patchLeague(request('PATCH', '/x', { body: { visibility: 'members' } }), params({ slug: league.slug }));
    expect(res.status).toBe(200);
    expect((await readJson(res)).league.visibility).toBe('members');
    expect((await repo.getLeagueBySlug(league.slug))!.visibility).toBe('members');
  });
});

describe('DELETE /admin/league (spec §4.4)', () => {
  it('deletes the league when the typed name matches', async () => {
    const { league } = await seedLeague(repo);
    const res = await deleteLeague(request('DELETE', '/x', { body: { confirmName: 'Habich Fam' } }), params({ slug: league.slug }));
    expect(res.status).toBe(204);
    expect(await repo.getLeagueBySlug(league.slug)).toBeNull();
  });
  it('answers 400 and keeps the league when the name is wrong', async () => {
    const { league } = await seedLeague(repo);
    const res = await deleteLeague(request('DELETE', '/x', { body: { confirmName: 'habich fam' } }), params({ slug: league.slug }));
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe('Type the league name exactly to delete it');
    expect(await repo.getLeagueBySlug(league.slug)).not.toBeNull();
  });
  it('is commissioner-only', async () => {
    const { league } = await seedLeague(repo);
    await signInAsMember(repo, league, 'Mom');
    const res = await deleteLeague(request('DELETE', '/x', { body: { confirmName: 'Habich Fam' } }), params({ slug: league.slug }));
    expect(res.status).toBe(403);
  });
});

describe('POST /admin/invite', () => {
  it('replaces the invite code; the old one stops working', async () => {
    const { league } = await seedLeague(repo);
    const res = await resetInvite(request('POST', '/x'), params({ slug: league.slug }));
    expect(res.status).toBe(200);
    const { inviteCode } = await readJson(res);
    expect(inviteCode).not.toBe(league.inviteCode);
    expect(await repo.getLeagueByInviteCode(league.inviteCode)).toBeNull();
    expect((await repo.getLeagueByInviteCode(inviteCode))!.id).toBe(league.id);
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
      inviteCode: league.inviteCode, visibility: 'link',
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
