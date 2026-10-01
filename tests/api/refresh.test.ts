import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import { POST as refresh } from '@/app/api/l/[slug]/admin/rounds/[id]/refresh/route';
import type { Repo } from '@/lib/db/repo';
import { defaultScoring } from '@/lib/scoring/config';
import { setUser, signInAsMember } from '../helpers/auth';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;

beforeEach(() => {
  setUser(null);
  repo = createMemoryRepo();
  h.repo = repo;
  h.getTba = vi.fn(async () => ({ data: null, fetchedAt: '2026-10-24T18:00:00.000Z', stale: false }));
});

async function setup() {
  const { league } = await seedLeague(repo);
  const round = await repo.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
    scoring: defaultScoring(),
  });
  return { league, round };
}

describe('POST refresh (§5.5, §8.3)', () => {
  it('forces a refresh of all six event endpoints', async () => {
    const { league, round } = await setup();
    const res = await refresh(request('POST', '/x', {}), params({ slug: league.slug, id: round.id }));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ fetchedAt: '2026-10-24T18:00:00.000Z', stale: false });

    const calls = (h.getTba as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => c[0]).sort()).toEqual([
      '/event/2025parr/alliances',
      '/event/2025parr/awards',
      '/event/2025parr/matches/simple',
      '/event/2025parr/oprs',
      '/event/2025parr/rankings',
      '/event/2025parr/teams/simple',
    ]);
    for (const call of calls) expect(call[1]).toMatchObject({ force: true });
  });

  it('still answers 200 when TBA is down, and says the data is stale', async () => {
    h.getTba = vi.fn(async () => ({ data: null, fetchedAt: '2026-10-24T17:00:00.000Z', stale: true }));
    const { league, round } = await setup();
    const res = await refresh(request('POST', '/x', {}), params({ slug: league.slug, id: round.id }));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ fetchedAt: '2026-10-24T17:00:00.000Z', stale: true });
  });

  it('answers 409 for a manual round (nothing to refresh)', async () => {
    const { league } = await setup();
    const manual = await repo.createRound({
      leagueId: league.id, eventKey: null, kind: 'manual', eventName: 'Garage Games',
      startDate: '2026-11-07', endDate: '2026-11-07', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    const res = await refresh(request('POST', '/x'), params({ slug: league.slug, id: manual.id }));
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('Only rounds for a TBA event can be refreshed');
    expect(h.getTba).not.toHaveBeenCalled();
  });

  it('answers 401 signed out and 403 for a member who is not a commissioner, and does not call TBA', async () => {
    const { league, round } = await setup();
    const attempt = () => refresh(request('POST', '/x'), params({ slug: league.slug, id: round.id }));
    setUser(null);
    expect((await attempt()).status).toBe(401);

    await signInAsMember(repo, league, 'Mom', 'player');
    expect((await attempt()).status).toBe(403);
    expect(h.getTba).not.toHaveBeenCalled();
  });
});
