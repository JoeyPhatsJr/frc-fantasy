import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));

import { classifyFailedPick, draftError } from '@/lib/draft/errors';
import type { Repo } from '@/lib/db/repo';
import type { RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let round: RoundRow;
let joeyId: string;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  const { league, commissioner } = await seedLeague(repo);
  joeyId = commissioner.id;
  const mom = await repo.createMember({ leagueId: league.id, userId: randomUUID(), name: 'Mom', role: 'player' });
  const r = await repo.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
  });
  round = await repo.updateRound(r.id, { draftOrder: [joeyId, mom.id], rosterSize: 2, draftMode: 'live' });
  await repo.draftControl(round.id, 'start');
});

describe('classifyFailedPick', () => {
  it('says taken when the team is already on the board', async () => {
    await repo.makePickAtomic({ roundId: round.id, pickNumber: 0, playerId: joeyId, teamKey: 'frc1', requireDue: false, auto: false });
    const err = await classifyFailedPick(round.id, 'frc1');
    expect([err.status, err.code, err.message]).toEqual([409, 'taken', 'That team was just taken']);
  });
  it('says not_live when the draft is paused', async () => {
    await repo.draftControl(round.id, 'pause');
    expect((await classifyFailedPick(round.id, 'frc2')).code).toBe('not_live');
  });
  it('otherwise says stale', async () => {
    expect((await classifyFailedPick(round.id, 'frc2')).code).toBe('stale');
    expect(draftError('stale').message).toBe('Draft changed in another tab — refresh');
  });
});
