import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks, resetDraftMocks } from '../helpers/draftMocks';

vi.mock('@/lib/db', async () => (await import('../helpers/draftMocks')).dbModule);
vi.mock('@/lib/tba/client', async () => (await import('../helpers/draftMocks')).tbaModule);

import { advance } from '@/lib/draft/advance';
import { seedLiveDraft, T0 } from '../helpers/draft';
import { createMemoryRepo } from '../helpers/memoryRepo';

beforeEach(() => resetDraftMocks(createMemoryRepo({ now: () => T0 })));

const teams = async (roundId: string) =>
  (await mocks.repo.listPicks(roundId)).map((p) => `${p.pickNumber}:${p.teamKey}:${p.auto ? 'auto' : 'hand'}`);

describe('advance (§7.4)', () => {
  it('first picker on auto-draft with the timer off: picks at once, then waits for Mom (Review Focus 2)', async () => {
    const { round, joey } = await seedLiveDraft(mocks.repo, { pickSeconds: null });
    await mocks.repo.setAutodraft(round.id, joey.id, true);
    await mocks.repo.draftControl(round.id, 'start');
    expect(await advance(round.id, T0)).toBe(1);
    expect(await teams(round.id)).toEqual(['0:frc1:auto']);
  });

  it('chains through every auto-drafter, using each queue first', async () => {
    const { round, joey, mom } = await seedLiveDraft(mocks.repo, { pickSeconds: null });
    await mocks.repo.setAutodraft(round.id, joey.id, true);
    await mocks.repo.setAutodraft(round.id, mom.id, true);
    await mocks.repo.setQueue(round.id, mom.id, ['frc7', 'frc1']);
    await mocks.repo.draftControl(round.id, 'start');
    expect(await advance(round.id, T0)).toBe(4);
    // Snake: Joey, Mom, Mom, Joey. Mom's queue: frc7, then frc1 is gone so she falls back to lowest number.
    expect(await teams(round.id)).toEqual(['0:frc1:auto', '1:frc7:auto', '2:frc2:auto', '3:frc3:auto']);
  });

  it('does nothing when the on-clock player is not on auto-draft', async () => {
    const { round, mom } = await seedLiveDraft(mocks.repo, { start: true });
    await mocks.repo.setAutodraft(round.id, mom.id, true);
    expect(await advance(round.id, T0)).toBe(0);
  });

  it('does nothing while paused or in commissioner mode', async () => {
    const paused = await seedLiveDraft(mocks.repo, { start: true });
    await mocks.repo.setAutodraft(paused.round.id, paused.joey.id, true);
    await mocks.repo.draftControl(paused.round.id, 'pause');
    expect(await advance(paused.round.id, T0)).toBe(0);

    resetDraftMocks(createMemoryRepo({ now: () => T0 }));
    const v1 = await seedLiveDraft(mocks.repo, { mode: 'commissioner' });
    await mocks.repo.setAutodraft(v1.round.id, v1.joey.id, true);
    expect(await advance(v1.round.id, T0)).toBe(0);
  });

  it('after resume onto an auto-drafter, picks for them', async () => {
    const { round, joey } = await seedLiveDraft(mocks.repo, { start: true });
    await mocks.repo.draftControl(round.id, 'pause');
    await mocks.repo.setAutodraft(round.id, joey.id, true);
    await mocks.repo.draftControl(round.id, 'resume');
    expect(await advance(round.id, T0)).toBe(1);
  });

  it('stops when the draft is done, and does nothing on an unknown round', async () => {
    const { round, joey, mom } = await seedLiveDraft(mocks.repo, { pickSeconds: null });
    await mocks.repo.setAutodraft(round.id, joey.id, true);
    await mocks.repo.setAutodraft(round.id, mom.id, true);
    await mocks.repo.draftControl(round.id, 'start');
    expect(await advance(round.id, T0)).toBe(4);
    expect(await advance(round.id, T0)).toBe(0);
    expect(await advance('00000000-0000-0000-0000-000000000000', T0)).toBe(0);
  });

  it('never picks outside the pool: a pool smaller than the picks left stops quietly', async () => {
    const { round, joey, mom } = await seedLiveDraft(mocks.repo, { pickSeconds: null, rosterSize: 6 });
    await mocks.repo.setAutodraft(round.id, joey.id, true);
    await mocks.repo.setAutodraft(round.id, mom.id, true);
    await mocks.repo.draftControl(round.id, 'start');
    // 12 picks wanted, 8 teams exist.
    expect(await advance(round.id, T0)).toBe(8);
    const keys = (await mocks.repo.listPicks(round.id)).map((p) => p.teamKey);
    expect(new Set(keys).size).toBe(8);
  });
});
