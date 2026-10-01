import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);

import { setUser } from '../helpers/auth';
import { POST as startSeason } from '@/app/api/l/[slug]/admin/seasons/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, PlayerRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;
let me: PlayerRow;
let season: RoundRow;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  h.getTba = vi.fn(async () => ({ data: [], fetchedAt: 'x', stale: false }));
  const seeded = await seedLeague(repo, { format: 'season' });
  league = seeded.league;
  me = seeded.commissioner;
  setUser(seeded.user);
  season = await repo.createRound({
    leagueId: league.id, eventKey: null, kind: 'season', seasonYear: 2027, eventName: '2027 Season',
    startDate: '2027-03-05', endDate: '2027-04-18', timezone: 'America/New_York', scoring: defaultScoring(),
    rosterSize: 10, draftOrder: [], poolFilter: { type: 'district', key: '2027fma' },
  });
  await repo.updateRound(season.id, { draftOrder: [me.id] });
});

const start = () => startSeason(request('POST', '/x'), params({ slug: league.slug }));

describe('POST /admin/seasons', () => {
  it('waits until the current season is Final', async () => {
    const res = await start();
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('Mark the 2027 season final first');
  });

  it('creates next season with the same order, roster size and (moved) district', async () => {
    await repo.updateRound(season.id, { finalizedAt: '2027-05-01T00:00:00.000Z' });
    const res = await start();
    expect(res.status).toBe(201);
    const next = (await repo.listRounds(league.id)).find((r) => r.seasonYear === 2028)!;
    expect(await readJson(res)).toEqual({ round: { id: next.id, eventName: '2028 Season', seasonYear: 2028 } });
    expect(next).toMatchObject({
      kind: 'season', eventName: '2028 Season', rosterSize: 10, draftOrder: [me.id],
      poolFilter: { type: 'district', key: '2028fma' }, startDate: '2028-01-01', endDate: '2028-12-31',
    });
    expect((await start()).status).toBe(409); // 2028 isn't Final yet
  });

  it('leaves players without an account out of the copied draft order', async () => {
    const guest = await repo.createPlayer(league.id, 'Grandpa'); // no linked account
    await repo.updateRound(season.id, { draftOrder: [guest.id, me.id], finalizedAt: '2027-05-01T00:00:00.000Z' });
    expect((await start()).status).toBe(201);
    expect((await repo.listRounds(league.id)).find((r) => r.seasonYear === 2028)!.draftOrder).toEqual([me.id]);
  });

  it('is only for season leagues', async () => {
    const eventLeague = await seedLeague(repo, { slug: 'event-fam-abc234' });
    setUser(eventLeague.user);
    const res = await startSeason(request('POST', '/x'), params({ slug: eventLeague.league.slug }));
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('Only full-season leagues have seasons');
  });
});
