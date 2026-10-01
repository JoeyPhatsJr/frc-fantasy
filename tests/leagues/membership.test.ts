import { describe, expect, it } from 'vitest';
import { assertKeepsCommissioner, LAST_COMMISSIONER_MESSAGE, removeMember } from '@/lib/leagues/membership';
import type { PlayerRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { createMemoryRepo } from '../helpers/memoryRepo';

const row = (id: string, role: PlayerRow['role'], userId: string | null): PlayerRow => ({
  id, leagueId: 'L', name: id, role, userId, createdAt: '2026-01-01T00:00:00.000Z',
});

describe('assertKeepsCommissioner (spec §4.3)', () => {
  it('blocks removing or demoting the only linked commissioner', () => {
    const joey = row('joey', 'commissioner', 'u1');
    const mom = row('mom', 'player', 'u2');
    expect(() => assertKeepsCommissioner([joey, mom], joey)).toThrow(LAST_COMMISSIONER_MESSAGE);
  });
  it('ignores unlinked commissioners when counting', () => {
    const joey = row('joey', 'commissioner', 'u1');
    const gone = row('gone', 'commissioner', null);
    expect(() => assertKeepsCommissioner([joey, gone], joey)).toThrow();
  });
  it('allows it when another linked commissioner exists, or the target is a player', () => {
    const joey = row('joey', 'commissioner', 'u1');
    const mom = row('mom', 'commissioner', 'u2');
    expect(() => assertKeepsCommissioner([joey, mom], joey)).not.toThrow();
    expect(() => assertKeepsCommissioner([joey, mom], row('dad', 'player', 'u3'))).not.toThrow();
  });
});

describe('removeMember (spec §4.3)', () => {
  async function setup() {
    const repo = createMemoryRepo();
    const league = await repo.createLeague({ slug: 'fam-abc234', name: 'Fam', defaultScoring: defaultScoring() });
    await repo.createProfile({ id: 'u-mom', displayName: 'Mom', avatarUrl: null });
    const mom = await repo.createMember({ leagueId: league.id, userId: 'u-mom', name: 'Mom', role: 'commissioner' });
    const round = await repo.createRound({
      leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot', startDate: '2025-10-25',
      endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    return { repo, league, mom, round };
  }

  it('deletes a member with no history', async () => {
    const { repo, league, mom } = await setup();
    expect(await removeMember(repo, mom)).toBe('deleted');
    expect(await repo.listPlayers(league.id)).toEqual([]);
  });

  it('unlinks (and demotes) a member who has picks, keeping the name', async () => {
    const { repo, league, mom, round } = await setup();
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc341' });
    expect(await removeMember(repo, mom)).toBe('unlinked');
    const [kept] = await repo.listPlayers(league.id);
    expect(kept).toMatchObject({ id: mom.id, name: 'Mom', userId: null, role: 'player' });
    expect(await repo.listPicks(round.id)).toHaveLength(1);
  });

  it('unlinks a member who is only in a draft order', async () => {
    const { repo, mom, round } = await setup();
    await repo.updateRound(round.id, { draftOrder: [mom.id] });
    expect(await removeMember(repo, mom)).toBe('unlinked');
  });
});
