import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks, resetDraftMocks } from '../helpers/draftMocks';

vi.mock('@/lib/db', async () => (await import('../helpers/draftMocks')).dbModule);
vi.mock('@/lib/tba/client', async () => (await import('../helpers/draftMocks')).tbaModule);
vi.mock('@/lib/auth/session', async () => (await import('../helpers/draftMocks')).sessionModule);
vi.mock('@/lib/realtime/doorbell', async () => (await import('../helpers/draftMocks')).doorbellModule);
// A database blip inside advance(), after the change itself is already saved (review I1 / risk T8).
const advanceMock = vi.hoisted(() => vi.fn(async (_roundId: string, _now: Date): Promise<number> => {
  throw new Error('db blip');
}));
vi.mock('@/lib/draft/advance', () => ({ advance: advanceMock }));

import { POST as controlRoute } from '@/app/api/l/[slug]/admin/rounds/[id]/draft/[action]/route';
import { DELETE as undoRoute } from '@/app/api/l/[slug]/admin/rounds/[id]/picks/[pickNumber]/route';
import { POST as adminPickRoute } from '@/app/api/l/[slug]/admin/rounds/[id]/picks/route';
import { PUT as autodraftRoute } from '@/app/api/l/[slug]/rounds/[id]/draft/autodraft/route';
import { POST as pickRoute } from '@/app/api/l/[slug]/rounds/[id]/draft/pick/route';
import { POST as tickRoute } from '@/app/api/l/[slug]/rounds/[id]/draft/tick/route';
import { params, readJson, request } from '../helpers/api';
import { seedLiveDraft, T0 } from '../helpers/draft';
import { createMemoryRepo } from '../helpers/memoryRepo';

const clock = { now: T0 };
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  clock.now = T0;
  resetDraftMocks(createMemoryRepo({ now: () => clock.now }));
  advanceMock.mockClear();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

type Seeded = Awaited<ReturnType<typeof seedLiveDraft>>;
const ids = (s: Seeded) => ({ slug: s.league.slug, id: s.round.id });

/** The change was saved, advance() threw: still a success, still rang, and the failure is logged. */
function expectRangDespiteAdvanceFailure(s: Seeded) {
  expect(advanceMock).toHaveBeenCalledTimes(1);
  expect(mocks.ring).toHaveBeenCalledTimes(1);
  expect(mocks.ring).toHaveBeenCalledWith(s.round.id);
  expect(consoleError).toHaveBeenCalled();
}

describe('a failing advance() never turns a saved change into an error (review I1)', () => {
  it('member pick: 201 and rings', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    const res = await pickRoute(request('POST', '/x', { body: { expectedPickNumber: 0, teamKey: 'frc3' } }), params(ids(s)));
    expect(res.status).toBe(201);
    expect(await mocks.repo.listPicks(s.round.id)).toHaveLength(1);
    expectRangDespiteAdvanceFailure(s);
  });

  it('timeout tick: picked and rings', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true, pickSeconds: 30 });
    mocks.user = s.momUser;
    clock.now = later(31);
    const res = await tickRoute(request('POST', '/x', { body: { expectedPickNumber: 0 } }), params(ids(s)));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ picked: true });
    expectRangDespiteAdvanceFailure(s);
  });

  it('auto-draft on: 200 with picked 0 and rings', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    const res = await autodraftRoute(request('PUT', '/x', { body: { on: true } }), params(ids(s)));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ autodraft: true, picked: 0 });
    expect(await mocks.repo.getAutodraft(s.round.id, s.joey.id)).toBe(true);
    expectRangDespiteAdvanceFailure(s);
  });

  it('commissioner "Pick for": 201 and rings', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    const res = await adminPickRoute(request('POST', '/x', { body: { expectedPickNumber: 0, teamKey: 'frc2' } }), params(ids(s)));
    expect(res.status).toBe(201);
    expectRangDespiteAdvanceFailure(s);
  });

  it('commissioner undo: 204 and rings', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    await mocks.repo.makePickAtomic({ roundId: s.round.id, pickNumber: 0, playerId: s.joey.id, teamKey: 'frc1', requireDue: false, auto: false });
    mocks.user = s.joeyUser;
    const res = await undoRoute(request('DELETE', '/x'), params({ ...ids(s), pickNumber: '0' }));
    expect(res.status).toBe(204);
    expect(await mocks.repo.listPicks(s.round.id)).toHaveLength(0);
    expectRangDespiteAdvanceFailure(s);
  });

  it('draft start: 200 with the state and rings', async () => {
    const s = await seedLiveDraft(mocks.repo);
    mocks.user = s.joeyUser;
    const res = await controlRoute(request('POST', '/x'), params({ ...ids(s), action: 'start' }));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({ phase: 'live', pickNumber: 0 });
    expectRangDespiteAdvanceFailure(s);
  });

  it('draft pause skips advance but still rings', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    const res = await controlRoute(request('POST', '/x'), params({ ...ids(s), action: 'pause' }));
    expect(res.status).toBe(200);
    expect(advanceMock).not.toHaveBeenCalled();
    expect(mocks.ring).toHaveBeenCalledTimes(1);
  });
});
