import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks, resetDraftMocks } from '../helpers/draftMocks';

vi.mock('@/lib/db', async () => (await import('../helpers/draftMocks')).dbModule);
vi.mock('@/lib/tba/client', async () => (await import('../helpers/draftMocks')).tbaModule);
vi.mock('@/lib/auth/session', async () => (await import('../helpers/draftMocks')).sessionModule);
vi.mock('@/lib/realtime/doorbell', async () => (await import('../helpers/draftMocks')).doorbellModule);

import { POST as pickRoute } from '@/app/api/l/[slug]/rounds/[id]/draft/pick/route';
import { POST as tickRoute } from '@/app/api/l/[slug]/rounds/[id]/draft/tick/route';
import { createMemoryRepo } from '../helpers/memoryRepo';
import { params, readJson, request } from '../helpers/api';
import { seedLiveDraft, T0 } from '../helpers/draft';

const clock = { now: T0 };
beforeEach(() => {
  clock.now = T0;
  resetDraftMocks(createMemoryRepo({ now: () => clock.now }));
});
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

type Seeded = Awaited<ReturnType<typeof seedLiveDraft>>;
const pick = (s: Seeded, expectedPickNumber: number, teamKey: string) =>
  pickRoute(request('POST', '/x', { body: { expectedPickNumber, teamKey } }), params({ slug: s.league.slug, id: s.round.id }));
const tick = (s: Seeded, expectedPickNumber: number) =>
  tickRoute(request('POST', '/x', { body: { expectedPickNumber } }), params({ slug: s.league.slug, id: s.round.id }));
const codeOf = async (res: Response) => [res.status, (await readJson(res)).code];

describe('POST draft/pick (§7.3)', () => {
  it('lets the on-clock member pick, moves the deadline, and rings once', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    clock.now = later(12);
    const res = await pick(s, 0, 'frc3');
    expect(res.status).toBe(201);
    expect(await readJson(res)).toEqual({ pick: { pickNumber: 0, playerId: s.joey.id, teamKey: 'frc3' } });
    expect((await mocks.repo.getRound(s.round.id))!.pickDeadline).toBe(later(72).toISOString());
    expect(mocks.ring).toHaveBeenCalledTimes(1);
    expect(mocks.ring).toHaveBeenCalledWith(s.round.id);
  });

  it('refuses the wrong player, a stale number, and a taken team with the right codes', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.momUser;
    expect(await codeOf(await pick(s, 0, 'frc1'))).toEqual([409, 'not_your_turn']);
    mocks.user = s.joeyUser;
    expect(await codeOf(await pick(s, 3, 'frc1'))).toEqual([409, 'stale']);
    await pick(s, 0, 'frc1');
    mocks.user = s.momUser;
    expect(await codeOf(await pick(s, 1, 'frc1'))).toEqual([409, 'taken']);
    expect(mocks.ring).toHaveBeenCalledTimes(1);
  });

  it('a double tap from two phones: one 201, one clean 409 (Review Focus 1)', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    const spy = vi.spyOn(mocks.repo, 'makePickAtomic');
    const [a, b] = await Promise.all([pick(s, 0, 'frc1'), pick(s, 0, 'frc2')]);
    // Both requests pass the route's checks; draft_make_pick decides the race.
    expect(spy).toHaveBeenCalledTimes(2);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(['stale', 'taken']).toContain((await readJson(loser)).code);
    expect(await mocks.repo.listPicks(s.round.id)).toHaveLength(1);
  });

  it('a double tap on the same team: one 201, one taken', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    const spy = vi.spyOn(mocks.repo, 'makePickAtomic');
    const [a, b] = await Promise.all([pick(s, 0, 'frc4'), pick(s, 0, 'frc4')]);
    // Both requests pass the route's checks; draft_make_pick decides the race.
    expect(spy).toHaveBeenCalledTimes(2);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect((await readJson(loser)).code).toBe('taken');
    expect(await mocks.repo.listPicks(s.round.id)).toMatchObject([{ pickNumber: 0, teamKey: 'frc4' }]);
    expect(mocks.ring).toHaveBeenCalledTimes(1);
  });

  it('refuses when not live: before start, while paused, commissioner mode', async () => {
    const s = await seedLiveDraft(mocks.repo);
    mocks.user = s.joeyUser;
    expect(await codeOf(await pick(s, 0, 'frc1'))).toEqual([409, 'not_live']);
    await mocks.repo.draftControl(s.round.id, 'start');
    await mocks.repo.draftControl(s.round.id, 'pause');
    expect(await codeOf(await pick(s, 0, 'frc1'))).toEqual([409, 'not_live']);
  });

  it('refuses a commissioner-mode round as not live', async () => {
    const s = await seedLiveDraft(mocks.repo, { mode: 'commissioner' });
    mocks.user = s.joeyUser;
    expect(await codeOf(await pick(s, 0, 'frc1'))).toEqual([409, 'not_live']);
    expect(await mocks.repo.listPicks(s.round.id)).toHaveLength(0);
  });

  it('400s a team outside the pool and bad bodies', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    expect((await pick(s, 0, 'frc9999')).status).toBe(400);
    expect((await pick(s, -1, 'frc1')).status).toBe(400);
    expect((await pick(s, 0, 'team341')).status).toBe(400);
  });

  it('401 signed out, 403 for a stranger', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    expect((await pick(s, 0, 'frc1')).status).toBe(401);
    mocks.user = s.strangerUser;
    expect((await pick(s, 0, 'frc1')).status).toBe(403);
  });

  it('after a pick, auto-drafters on the clock are picked for right away', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    await mocks.repo.setAutodraft(s.round.id, s.mom.id, true);
    mocks.user = s.joeyUser;
    await pick(s, 0, 'frc5');
    // Snake [Joey, Mom]: Mom has picks 1 and 2, both auto (lowest numbers first).
    expect((await mocks.repo.listPicks(s.round.id)).map((p) => [p.teamKey, p.auto])).toEqual([
      ['frc5', false], ['frc1', true], ['frc2', true],
    ]);
  });
});

describe('POST draft/tick (§7.4)', () => {
  it('does nothing before the database deadline, even if a phone thinks time is up (Review Focus 4)', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true, pickSeconds: 30 });
    mocks.user = s.momUser;
    clock.now = later(29);
    const res = await tick(s, 0);
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ picked: false });
    expect(await mocks.repo.listPicks(s.round.id)).toHaveLength(0);
    expect(mocks.ring).not.toHaveBeenCalled();
  });

  it('after the deadline, auto-picks for the on-clock player from their queue', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true, pickSeconds: 30 });
    await mocks.repo.setQueue(s.round.id, s.joey.id, ['frc6']);
    mocks.user = s.momUser; // anyone in the league may send the tick
    clock.now = later(31);
    expect(await readJson(await tick(s, 0))).toEqual({ picked: true });
    expect(await mocks.repo.listPicks(s.round.id)).toMatchObject([{ pickNumber: 0, playerId: s.joey.id, teamKey: 'frc6', auto: true }]);
    expect(mocks.ring).toHaveBeenCalledTimes(1);
    // A second phone's tick for the same pick is a no-op.
    expect(await readJson(await tick(s, 0))).toEqual({ picked: false });
  });

  it('after the deadline with an empty queue, falls back to the lowest team number', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true, pickSeconds: 30 });
    mocks.user = s.joeyUser; // Joey's phone also sends the tick for Mom's turn
    await pick(s, 0, 'frc1');
    clock.now = later(31);
    // The pick at T0 moved Mom's deadline to T0+30 s.
    expect(await readJson(await tick(s, 1))).toEqual({ picked: true });
    expect((await mocks.repo.listPicks(s.round.id)).map((p) => [p.pickNumber, p.playerId, p.teamKey, p.auto])).toEqual([
      [0, s.joey.id, 'frc1', false], [1, s.mom.id, 'frc2', true],
    ]);
    expect(mocks.ring).toHaveBeenCalledTimes(2);
  });

  it('two phones ticking at once: exactly one auto-pick', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true, pickSeconds: 30 });
    clock.now = later(31);
    mocks.user = s.momUser;
    const results = await Promise.all([tick(s, 0), tick(s, 0)].map(async (r) => (await readJson(await r)).picked));
    expect(results.sort()).toEqual([false, true]);
    expect(await mocks.repo.listPicks(s.round.id)).toMatchObject([{ pickNumber: 0, playerId: s.joey.id, teamKey: 'frc1', auto: true }]);
    expect(mocks.ring).toHaveBeenCalledTimes(1);
  });

  it('ignores a tick for the wrong pick number', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true, pickSeconds: 30 });
    mocks.user = s.momUser;
    clock.now = later(31);
    expect(await readJson(await tick(s, 1))).toEqual({ picked: false });
    expect(await mocks.repo.listPicks(s.round.id)).toHaveLength(0);
    expect(mocks.ring).not.toHaveBeenCalled();
  });

  it('never fires with the timer off, and needs membership', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true, pickSeconds: null });
    mocks.user = s.momUser;
    clock.now = later(3600);
    expect(await readJson(await tick(s, 0))).toEqual({ picked: false });
    mocks.user = null;
    expect((await tick(s, 0)).status).toBe(401);
  });
});
