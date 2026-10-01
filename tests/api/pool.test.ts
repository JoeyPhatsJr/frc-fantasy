import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks, resetDraftMocks } from '../helpers/draftMocks';

vi.mock('@/lib/db', async () => (await import('../helpers/draftMocks')).dbModule);
vi.mock('@/lib/tba/client', async () => (await import('../helpers/draftMocks')).tbaModule);
vi.mock('@/lib/auth/session', async () => (await import('../helpers/draftMocks')).sessionModule);

import { GET as getPool } from '@/app/api/l/[slug]/rounds/[id]/pool/route';
import { params, readJson, request } from '../helpers/api';
import { seedLiveDraft, T0 } from '../helpers/draft';
import { createMemoryRepo } from '../helpers/memoryRepo';

beforeEach(() => resetDraftMocks(createMemoryRepo({ now: () => T0 })));

const call = (slug: string, id: string) => getPool(request('GET', '/x'), params({ slug, id }));

describe('GET pool (§6.3)', () => {
  it('is open to anyone for link leagues', async () => {
    const { league, round } = await seedLiveDraft(mocks.repo);
    const res = await call(league.slug, round.id);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body).toHaveLength(8);
    expect(body[0]).toMatchObject({ teamKey: 'frc1', nickname: 'Team 1', proj: null, available: true });
  });

  it('is members-only for members leagues', async () => {
    const { league, round, momUser, strangerUser } = await seedLiveDraft(mocks.repo);
    await mocks.repo.updateLeague(league.id, { visibility: 'members' });
    expect((await call(league.slug, round.id)).status).toBe(403);
    mocks.user = strangerUser;
    expect((await call(league.slug, round.id)).status).toBe(403);
    mocks.user = momUser;
    expect((await call(league.slug, round.id)).status).toBe(200);
  });

  it('404s for unknown leagues, junk ids, and rounds of another league', async () => {
    const { league } = await seedLiveDraft(mocks.repo);
    expect((await call('nope', '00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await call(league.slug, 'not-a-uuid')).status).toBe(404);
  });
});
