import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks, resetDraftMocks } from '../helpers/draftMocks';

vi.mock('@/lib/db', async () => (await import('../helpers/draftMocks')).dbModule);
vi.mock('@/lib/tba/client', async () => (await import('../helpers/draftMocks')).tbaModule);

import { buildPoolEntries, noPoolStats, type PoolStatsLookup } from '@/lib/pool/entries';
import { seedLiveDraft, T0 } from '../helpers/draft';
import { createMemoryRepo } from '../helpers/memoryRepo';

beforeEach(() => resetDraftMocks(createMemoryRepo({ now: () => T0 })));

describe('buildPoolEntries', () => {
  it('lists every pool team with stats empty and taken teams unavailable', async () => {
    const { round, joey } = await seedLiveDraft(mocks.repo, { start: true });
    await mocks.repo.makePickAtomic({ roundId: round.id, pickNumber: 0, playerId: joey.id, teamKey: 'frc2', requireDue: false, auto: false });
    const entries = await buildPoolEntries(round, T0);
    expect(entries).toHaveLength(8);
    expect(entries[0]).toEqual({
      teamKey: 'frc1', nickname: 'Team 1', proj: null, record: null, bestFinish: null, opr: null, rank: null, available: true,
    });
    expect(entries.find((e) => e.teamKey === 'frc2')?.available).toBe(false);
    expect(await noPoolStats(['frc1'], 2025)).toEqual(new Map());
  });

  it('merges whatever a stats lookup returns, asking for the round season', async () => {
    const { round } = await seedLiveDraft(mocks.repo);
    const lookup: PoolStatsLookup = vi.fn(async () =>
      new Map([['frc1', { proj: 38.2, record: [8, 2, 0] as [number, number, number], bestFinish: 'winner' as const, opr: 41.5, rank: 1 }]]),
    );
    const entries = await buildPoolEntries(round, T0, lookup);
    expect(lookup).toHaveBeenCalledWith(expect.arrayContaining(['frc1', 'frc8']), 2025);
    expect(entries[0]).toMatchObject({ teamKey: 'frc1', proj: 38.2, bestFinish: 'winner', available: true });
    expect(entries[1].proj).toBeNull();
  });
});
