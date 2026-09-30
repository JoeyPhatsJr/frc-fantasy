import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import { POST as refresh } from '@/app/api/l/[slug]/admin/rounds/[id]/refresh/route';
import type { Repo } from '@/lib/db/repo';
import { defaultScoring } from '@/lib/scoring/config';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;

beforeEach(() => {
  repo = createMemoryRepo();
  h.repo = repo;
  h.getTba = vi.fn(async () => ({ data: null, fetchedAt: '2026-10-24T18:00:00.000Z', stale: false }));
});

async function setup() {
  const { league, token } = await seedLeague(repo);
  const round = await repo.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
    scoring: defaultScoring(),
  });
  return { league, token, round };
}

describe('POST refresh (§5.5, §8.3)', () => {
  it('forces a refresh of all six event endpoints', async () => {
    const { league, token, round } = await setup();
    const res = await refresh(request('POST', '/x', { token }), params({ slug: league.slug, id: round.id }));
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
    const { league, token, round } = await setup();
    const res = await refresh(request('POST', '/x', { token }), params({ slug: league.slug, id: round.id }));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ fetchedAt: '2026-10-24T17:00:00.000Z', stale: true });
  });

  it('answers 403 without a token and does not call TBA', async () => {
    const { league, round } = await setup();
    const res = await refresh(request('POST', '/x'), params({ slug: league.slug, id: round.id }));
    expect(res.status).toBe(403);
    expect(h.getTba).not.toHaveBeenCalled();
  });
});
