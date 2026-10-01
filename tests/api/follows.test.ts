import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);

import { setUser } from '../helpers/auth';
import { PUT as putFollows } from '@/app/api/l/[slug]/admin/follows/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  h.getTba = vi.fn(async (path: unknown) =>
    String(path) === '/team/frc5181/events/2026/simple'
      ? { data: [{ key: '2026parr', name: 'Ramp Riot', event_type: 99, start_date: '2099-10-24', end_date: '2099-10-24' }], fetchedAt: 'x', stale: false }
      : { data: null, fetchedAt: 'x', stale: false },
  );
  const seeded = await seedLeague(repo);
  league = seeded.league;
  setUser(seeded.user);
});

const put = (teams: unknown, slug = league.slug) =>
  putFollows(request('PUT', '/x', { body: { teams } }), params({ slug }));

describe('PUT /admin/follows', () => {
  it('saves the list and syncs right away', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // only Date: promises and timers keep running
    vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'));
    const res = await put([5181]);
    vi.useRealTimers();
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ follows: [5181], added: 1, synced: true });
    expect((await repo.listRounds(league.id)).map((r) => r.eventKey)).toEqual(['2026parr']);
  });

  it('clears the list', async () => {
    await repo.setFollows(league.id, [5181]);
    const res = await put([]);
    expect(await readJson(res)).toEqual({ follows: [], added: 0, synced: true });
    expect(await repo.listFollows(league.id)).toEqual([]);
  });

  it.each([
    [[1, 2, 3, 4], 'Follow at most 3 teams'],
    [[5181, 5181], 'Each team can only be followed once'],
    [[0], 'Team numbers are 1 to 99999'],
    [[100000], 'Team numbers are 1 to 99999'],
    [['5181'], 'Team numbers are 1 to 99999'],
  ])('rejects %j', async (teams, message) => {
    const res = await put(teams);
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe(message);
  });

  it('answers 409 in a season league', async () => {
    const season = await seedLeague(repo, { slug: 'season-fam-abc234', format: 'season' });
    setUser(season.user);
    const res = await put([5181], season.league.slug);
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('Only event-by-event leagues can follow teams');
  });

  it('is commissioner-only', async () => {
    setUser(null);
    expect((await put([5181])).status).toBe(401);
  });
});
