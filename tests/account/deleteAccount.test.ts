import { describe, expect, it } from 'vitest';
import { deleteAccount } from '@/lib/account/deleteAccount';
import { defaultScoring } from '@/lib/scoring/config';
import { createMemoryRepo } from '../helpers/memoryRepo';

async function setup() {
  const repo = createMemoryRepo();
  for (const [id, name] of [['u-joey', 'Joey'], ['u-mom', 'Mom']]) {
    await repo.createProfile({ id, displayName: name, avatarUrl: null });
  }
  const league = await repo.createLeague({ slug: 'fam-abc234', name: 'Fam', defaultScoring: defaultScoring(), createdBy: 'u-joey' });
  const joey = await repo.createMember({ leagueId: league.id, userId: 'u-joey', name: 'Joey', role: 'commissioner' });
  return { repo, league, joey };
}

describe('deleteAccount (spec §4.2)', () => {
  it("is blocked while I'm the only commissioner of a league with other members", async () => {
    const { repo, league } = await setup();
    await repo.createMember({ leagueId: league.id, userId: 'u-mom', name: 'Mom', role: 'player' });
    await expect(deleteAccount(repo, 'u-joey')).rejects.toMatchObject({
      status: 409,
      message: "You're the only commissioner of Fam. Make someone else commissioner first.",
    });
    expect(await repo.getProfile('u-joey')).not.toBeNull();
  });

  it('deletes leagues where I was the only member, then the user', async () => {
    const { repo } = await setup();
    await deleteAccount(repo, 'u-joey');
    expect(await repo.getLeagueBySlug('fam-abc234')).toBeNull();
    expect(await repo.getProfile('u-joey')).toBeNull();
  });

  it('unlinks me where I have history and someone else is commissioner', async () => {
    const { repo, league, joey } = await setup();
    await repo.createMember({ leagueId: league.id, userId: 'u-mom', name: 'Mom', role: 'commissioner' });
    const round = await repo.createRound({
      leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot', startDate: '2025-10-25',
      endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: joey.id, teamKey: 'frc341' });
    await deleteAccount(repo, 'u-joey');
    const kept = (await repo.listPlayers(league.id)).find((p) => p.id === joey.id)!;
    expect(kept).toMatchObject({ name: 'Joey', userId: null });
  });

  it('a blocked league anywhere changes nothing in my other leagues', async () => {
    const { repo, league } = await setup();
    await repo.createMember({ leagueId: league.id, userId: 'u-mom', name: 'Mom', role: 'player' });
    const solo = await repo.createLeague({ slug: 'solo-abc234', name: 'Solo', defaultScoring: defaultScoring(), createdBy: 'u-joey' });
    await repo.createMember({ leagueId: solo.id, userId: 'u-joey', name: 'Joey', role: 'commissioner' });
    await expect(deleteAccount(repo, 'u-joey')).rejects.toMatchObject({ status: 409 });
    expect(await repo.getLeagueBySlug('solo-abc234')).not.toBeNull();
  });
});
