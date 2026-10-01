import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks, resetDraftMocks } from '../helpers/draftMocks';

vi.mock('@/lib/db', async () => (await import('../helpers/draftMocks')).dbModule);
vi.mock('@/lib/tba/client', async () => (await import('../helpers/draftMocks')).tbaModule);
vi.mock('@/lib/auth/session', async () => (await import('../helpers/draftMocks')).sessionModule);
vi.mock('@/lib/realtime/doorbell', async () => (await import('../helpers/draftMocks')).doorbellModule);

import { POST as controlRoute } from '@/app/api/l/[slug]/admin/rounds/[id]/draft/[action]/route';
import { PATCH as patchRound } from '@/app/api/l/[slug]/admin/rounds/[id]/route';
import { params, readJson, request } from '../helpers/api';
import { seedLiveDraft, T0 } from '../helpers/draft';
import { createMemoryRepo } from '../helpers/memoryRepo';

const clock = { now: T0 };
beforeEach(() => {
  clock.now = T0;
  resetDraftMocks(createMemoryRepo({ now: () => clock.now }));
});
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

type Seeded = Awaited<ReturnType<typeof seedLiveDraft>>;
const control = (s: Seeded, action: string) =>
  controlRoute(request('POST', '/x'), params({ slug: s.league.slug, id: s.round.id, action }));
const patch = (s: Seeded, body: unknown) =>
  patchRound(request('PATCH', '/x', { body }), params({ slug: s.league.slug, id: s.round.id }));
const reload = async (s: Seeded) => (await mocks.repo.getRound(s.round.id))!;

describe('PATCH round draft settings (§7.3)', () => {
  it('switches draft mode and timer before the draft starts', async () => {
    const s = await seedLiveDraft(mocks.repo, { mode: 'commissioner', pickSeconds: null });
    mocks.user = s.joeyUser;
    expect((await patch(s, { draftMode: 'live', pickSeconds: 90 })).status).toBe(200);
    expect(await reload(s)).toMatchObject({ draftMode: 'live', pickSeconds: 90 });
    expect((await patch(s, { pickSeconds: 45 })).status).toBe(400);
  });

  it('locks draft mode, order, and a running timer once started', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    expect((await patch(s, { draftMode: 'commissioner' })).status).toBe(409);
    expect((await patch(s, { rosterSize: 3 })).status).toBe(409);
    expect((await patch(s, { pickSeconds: 30 })).status).toBe(409);
  });

  it('refuses a mode switch once commissioner-mode picks exist', async () => {
    const s = await seedLiveDraft(mocks.repo, { mode: 'commissioner' });
    await mocks.repo.insertPick({ roundId: s.round.id, pickNumber: 0, playerId: s.joey.id, teamKey: 'frc1' });
    mocks.user = s.joeyUser;
    expect((await patch(s, { draftMode: 'live' })).status).toBe(409);
  });

  it('changing the timer while paused gives the full new timer on resume (§7.1)', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true, pickSeconds: 30 });
    mocks.user = s.joeyUser;
    clock.now = later(20);
    await control(s, 'pause');
    expect((await patch(s, { pickSeconds: 120 })).status).toBe(200);
    expect((await reload(s)).pausedRemainingMs).toBeNull();
    await control(s, 'resume');
    expect((await reload(s)).pickDeadline).toBe(later(140).toISOString());
  });

  it('only commissioners', async () => {
    const s = await seedLiveDraft(mocks.repo);
    mocks.user = s.momUser;
    expect((await patch(s, { pickSeconds: 30 })).status).toBe(403);
  });
});

describe('draft start / pause / resume', () => {
  it('starts a ready live draft, rings, and returns the state', async () => {
    const s = await seedLiveDraft(mocks.repo);
    mocks.user = s.joeyUser;
    const res = await control(s, 'start');
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({ phase: 'live', pickNumber: 0, deadline: later(60).toISOString() });
    expect(mocks.ring).toHaveBeenCalledTimes(1);
    expect((await control(s, 'start')).status).toBe(409);
  });

  it('refuses to start commissioner-mode rounds, empty orders, and too-small pools', async () => {
    const v1 = await seedLiveDraft(mocks.repo, { mode: 'commissioner' });
    mocks.user = v1.joeyUser;
    expect((await control(v1, 'start')).status).toBe(409);

    resetDraftMocks(createMemoryRepo({ now: () => clock.now }));
    const big = await seedLiveDraft(mocks.repo, { rosterSize: 5 }); // 2 players × 5 > 8 teams
    mocks.user = big.joeyUser;
    const res = await control(big, 'start');
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('With 2 players and 8 teams, roster size can be at most 4');

    await mocks.repo.updateRound(big.round.id, { draftOrder: [], rosterSize: 2 });
    expect((await readJson(await control(big, 'start'))).error).toBe('Set the draft order before drafting');
  });

  it('first picker on auto-draft: start picks for them at once (Review Focus 2)', async () => {
    const s = await seedLiveDraft(mocks.repo, { pickSeconds: null });
    await mocks.repo.setAutodraft(s.round.id, s.joey.id, true);
    mocks.user = s.joeyUser;
    const state = await readJson(await control(s, 'start'));
    expect(state.pickNumber).toBe(1);
    expect(state.picks[0]).toMatchObject({ playerId: s.joey.id, auto: true });
  });

  it('pauses and resumes, keeping the time left', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    expect((await control(s, 'resume')).status).toBe(409);
    clock.now = later(15);
    expect(await readJson(await control(s, 'pause'))).toMatchObject({ phase: 'paused', pausedRemainingMs: 45_000 });
    expect((await control(s, 'pause')).status).toBe(409);
    clock.now = later(600);
    // Resumed at T0+600 with 45 s left.
    expect(await readJson(await control(s, 'resume'))).toMatchObject({ phase: 'live', deadline: later(645).toISOString() });
    expect(mocks.ring).toHaveBeenCalledTimes(2);
  });

  it('404s an unknown action and 403s players', async () => {
    const s = await seedLiveDraft(mocks.repo);
    mocks.user = s.joeyUser;
    expect((await control(s, 'explode')).status).toBe(404);
    mocks.user = s.momUser;
    expect((await control(s, 'start')).status).toBe(403);
  });
});
