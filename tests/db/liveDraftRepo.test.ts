import { describe, expect, it } from 'vitest';
import { defaultScoring } from '@/lib/scoring/config';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

async function setup(now = new Date('2026-10-23T23:00:00.000Z')) {
  const clock = { now };
  const repo = createMemoryRepo({ now: () => clock.now });
  const { league, commissioner } = await seedLeague(repo);
  const round = await repo.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
    scoring: defaultScoring(),
  });
  return { repo, clock, league, commissioner, round };
}

describe('live draft columns', () => {
  it('new rounds start in commissioner mode with no timer and no draft state', async () => {
    const { round } = await setup();
    expect(round).toMatchObject({
      draftMode: 'commissioner', pickSeconds: null, draftStartedAt: null,
      draftPausedAt: null, pausedRemainingMs: null, pickDeadline: null,
    });
  });

  it('updateRound stores draftMode, pickSeconds and pausedRemainingMs', async () => {
    const { repo, round } = await setup();
    const saved = await repo.updateRound(round.id, { draftMode: 'live', pickSeconds: 60, pausedRemainingMs: null });
    expect(saved).toMatchObject({ draftMode: 'live', pickSeconds: 60, pausedRemainingMs: null });
    expect((await repo.updateRound(round.id, { pickSeconds: null })).pickSeconds).toBeNull();
  });

  it('insertPick records auto = false unless told otherwise', async () => {
    const { repo, round, commissioner } = await setup();
    await repo.updateRound(round.id, { draftOrder: [commissioner.id] });
    const pick = await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: commissioner.id, teamKey: 'frc1' });
    expect(pick.auto).toBe(false);
  });
});
