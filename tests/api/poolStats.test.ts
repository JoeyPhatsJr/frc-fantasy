import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks, resetDraftMocks } from '../helpers/draftMocks';

vi.mock('@/lib/db', async () => (await import('../helpers/draftMocks')).dbModule);
vi.mock('@/lib/tba/client', async () => (await import('../helpers/draftMocks')).tbaModule);
vi.mock('@/lib/auth/session', async () => (await import('../helpers/draftMocks')).sessionModule);

import { GET as getPool } from '@/app/api/l/[slug]/rounds/[id]/pool/route';
import { advance } from '@/lib/draft/advance';
import type { TeamStatsRow } from '@/lib/db/types';
import { params, readJson, request } from '../helpers/api';
import { seedLiveDraft, T0 } from '../helpers/draft';
import { createMemoryRepo } from '../helpers/memoryRepo';

beforeEach(() => resetDraftMocks(createMemoryRepo({ now: () => T0 })));

const stat = (teamKey: string, totalPoints: number): TeamStatsRow => ({
  teamKey, season: 2025, eventsPlayed: 1, totalPoints, qualWins: 5, qualLosses: 3, qualTies: 0,
  bestFinish: 'picked', awards: [], events: [], latestEventKey: '2025pahat', latestOpr: 20, latestRank: 9,
  updatedAt: '2026-10-01T00:00:00.000Z',
});

describe('team_stats in the pool and auto-pick (SP3)', () => {
  it('the pool route returns real proj values, and "New" teams stay null', async () => {
    const { league, round } = await seedLiveDraft(mocks.repo);
    await mocks.repo.upsertTeamStats([stat('frc3', 25), stat('frc5', 61.5)]);
    const body = await readJson(await getPool(request('GET', '/x'), params({ slug: league.slug, id: round.id })));
    const by = (k: string) => body.find((e: { teamKey: string }) => e.teamKey === k);
    expect(by('frc5')).toMatchObject({ proj: 61.5, record: [5, 3, 0], bestFinish: 'picked', opr: 20, rank: 9 });
    expect(by('frc3').proj).toBe(25);
    expect(by('frc1').proj).toBeNull();
  });

  it('advance auto-picks the highest proj, not the lowest team number', async () => {
    const { round, joey, mom } = await seedLiveDraft(mocks.repo, { pickSeconds: null });
    await mocks.repo.upsertTeamStats([stat('frc3', 25), stat('frc5', 61.5)]);
    await mocks.repo.setAutodraft(round.id, joey.id, true);
    await mocks.repo.setAutodraft(round.id, mom.id, true);
    await mocks.repo.draftControl(round.id, 'start');
    expect(await advance(round.id, T0)).toBe(4);
    // Snake: Joey, Mom, Mom, Joey. proj order: frc5, frc3, then "New" teams by lowest number.
    const picks = (await mocks.repo.listPicks(round.id)).map((p) => p.teamKey);
    expect(picks).toEqual(['frc5', 'frc3', 'frc1', 'frc2']);
  });
});
