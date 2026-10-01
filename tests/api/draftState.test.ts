import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks, resetDraftMocks } from '../helpers/draftMocks';

vi.mock('@/lib/db', async () => (await import('../helpers/draftMocks')).dbModule);
vi.mock('@/lib/tba/client', async () => (await import('../helpers/draftMocks')).tbaModule);
vi.mock('@/lib/auth/session', async () => (await import('../helpers/draftMocks')).sessionModule);

import { GET as getState } from '@/app/api/l/[slug]/rounds/[id]/draft/state/route';
import { params, readJson, request } from '../helpers/api';
import { seedLiveDraft, T0 } from '../helpers/draft';
import { createMemoryRepo } from '../helpers/memoryRepo';

beforeEach(() => resetDraftMocks(createMemoryRepo({ now: () => T0 })));

const call = (slug: string, id: string) => getState(request('GET', '/x'), params({ slug, id }));

describe('GET draft/state (§7.3)', () => {
  it('shows the draft to a signed-out viewer of a link league, without "me"', async () => {
    const { league, round, joey, mom } = await seedLiveDraft(mocks.repo, { start: true });
    const res = await call(league.slug, round.id);
    expect(res.status).toBe(200);
    const s = await readJson(res);
    expect(s).toMatchObject({
      phase: 'live', draftMode: 'live', pickNumber: 0, totalPicks: 4, pickSeconds: 60,
      onClock: { playerId: joey.id, name: joey.name },
      deadline: new Date(T0.getTime() + 60_000).toISOString(),
      order: [{ playerId: joey.id, name: joey.name }, { playerId: mom.id, name: 'Mom' }],
      rosterSize: 2, picks: [], autodraftPlayerIds: [],
    });
    expect(typeof s.serverNow).toBe('string');
    expect(s.me).toBeUndefined();
  });

  it('adds my queue, auto-draft, and role for a member', async () => {
    const { league, round, mom, momUser } = await seedLiveDraft(mocks.repo, { start: true });
    await mocks.repo.setQueue(round.id, mom.id, ['frc4', 'frc2']);
    await mocks.repo.setAutodraft(round.id, mom.id, true);
    mocks.user = momUser;
    const s = await readJson(await call(league.slug, round.id));
    expect(s.me).toEqual({ playerId: mom.id, isCommissioner: false, queue: ['frc4', 'frc2'], autodraft: true });
    expect(s.autodraftPlayerIds).toEqual([mom.id]);
  });

  it('is setup before start and paused while paused', async () => {
    const { league, round } = await seedLiveDraft(mocks.repo);
    expect((await readJson(await call(league.slug, round.id))).phase).toBe('setup');
    await mocks.repo.draftControl(round.id, 'start');
    await mocks.repo.draftControl(round.id, 'pause');
    const s = await readJson(await call(league.slug, round.id));
    expect(s).toMatchObject({ phase: 'paused', deadline: null, pausedRemainingMs: 60_000 });
  });

  it('paused with under 10 s left shows the 10 s the player gets on resume (review M2)', async () => {
    const { league, round } = await seedLiveDraft(mocks.repo, { start: true });
    await mocks.repo.draftControl(round.id, 'pause');
    await mocks.repo.updateRound(round.id, { pausedRemainingMs: 3_000 });
    expect(await readJson(await call(league.slug, round.id))).toMatchObject({ phase: 'paused', pausedRemainingMs: 10_000 });
  });

  it('403s a non-member of a members-only league', async () => {
    const { league, round, strangerUser } = await seedLiveDraft(mocks.repo);
    await mocks.repo.updateLeague(league.id, { visibility: 'members' });
    mocks.user = strangerUser;
    expect((await call(league.slug, round.id)).status).toBe(403);
  });
});
