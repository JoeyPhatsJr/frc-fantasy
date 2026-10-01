import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks, resetDraftMocks } from '../helpers/draftMocks';

vi.mock('@/lib/db', async () => (await import('../helpers/draftMocks')).dbModule);
vi.mock('@/lib/tba/client', async () => (await import('../helpers/draftMocks')).tbaModule);
vi.mock('@/lib/auth/session', async () => (await import('../helpers/draftMocks')).sessionModule);
vi.mock('@/lib/realtime/doorbell', async () => (await import('../helpers/draftMocks')).doorbellModule);

import { PUT as autodraftRoute } from '@/app/api/l/[slug]/rounds/[id]/draft/autodraft/route';
import { PUT as queueRoute } from '@/app/api/l/[slug]/rounds/[id]/draft/queue/route';
import { params, readJson, request } from '../helpers/api';
import { seedLiveDraft, T0 } from '../helpers/draft';
import { createMemoryRepo } from '../helpers/memoryRepo';

beforeEach(() => resetDraftMocks(createMemoryRepo({ now: () => T0 })));

type Seeded = Awaited<ReturnType<typeof seedLiveDraft>>;
const putQueue = (s: Seeded, teamKeys: unknown) =>
  queueRoute(request('PUT', '/x', { body: { teamKeys } }), params({ slug: s.league.slug, id: s.round.id }));
const putAuto = (s: Seeded, on: unknown) =>
  autodraftRoute(request('PUT', '/x', { body: { on } }), params({ slug: s.league.slug, id: s.round.id }));

describe('PUT draft/queue', () => {
  it('replaces my whole queue, before or during the draft', async () => {
    const s = await seedLiveDraft(mocks.repo);
    mocks.user = s.momUser;
    await putQueue(s, ['frc3', 'frc1']);
    const res = await putQueue(s, ['frc8', 'frc3']);
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ queue: ['frc8', 'frc3'] });
    expect(await mocks.repo.getQueue(s.round.id, s.mom.id)).toEqual(['frc8', 'frc3']);
    expect(await mocks.repo.getQueue(s.round.id, s.joey.id)).toEqual([]);
  });

  it('rejects duplicates, teams outside the pool, and more than 100 teams', async () => {
    const s = await seedLiveDraft(mocks.repo);
    mocks.user = s.momUser;
    expect((await putQueue(s, ['frc1', 'frc1'])).status).toBe(400);
    expect((await putQueue(s, ['frc9999'])).status).toBe(400);
    const tooMany = Array.from({ length: 101 }, (_, i) => `frc${i + 1}`);
    expect((await putQueue(s, tooMany)).status).toBe(400);
    expect((await putQueue(s, 'frc1')).status).toBe(400);
  });

  it('needs membership', async () => {
    const s = await seedLiveDraft(mocks.repo);
    expect((await putQueue(s, [])).status).toBe(401);
    mocks.user = s.strangerUser;
    expect((await putQueue(s, [])).status).toBe(403);
  });
});

describe('PUT draft/autodraft', () => {
  it('stores my choice and rings', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.momUser;
    expect(await readJson(await putAuto(s, true))).toEqual({ autodraft: true, picked: 0 });
    expect(await mocks.repo.getAutodraft(s.round.id, s.mom.id)).toBe(true);
    expect(mocks.ring).toHaveBeenCalledTimes(1);
  });

  it('turning it on while I am on the clock picks for me at once', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    expect(await readJson(await putAuto(s, true))).toEqual({ autodraft: true, picked: 1 });
    expect((await mocks.repo.listPicks(s.round.id))[0]).toMatchObject({ playerId: s.joey.id, auto: true });
  });

  it('400s a non-boolean', async () => {
    const s = await seedLiveDraft(mocks.repo);
    mocks.user = s.momUser;
    expect((await putAuto(s, 'yes')).status).toBe(400);
  });
});
