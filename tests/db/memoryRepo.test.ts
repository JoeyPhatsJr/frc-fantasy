import { beforeEach, describe, expect, it } from 'vitest';
import { UniqueViolation, type Repo } from '@/lib/db/repo';
import { defaultScoring } from '@/lib/scoring/config';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;

async function seed() {
  const league = await repo.createLeague({
    slug: 'fam-abc234',
    name: 'Fam',
    adminTokenHash: 'hash',
    defaultScoring: defaultScoring(),
  });
  const mom = await repo.createPlayer(league.id, 'Mom');
  const round = await repo.createRound({
    leagueId: league.id,
    eventKey: '2025parr',
    eventName: 'Ramp Riot',
    startDate: '2025-10-25',
    endDate: '2025-10-25',
    timezone: 'America/New_York',
    scoring: defaultScoring(),
  });
  return { league, mom, round };
}

async function violation(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof UniqueViolation) return err.constraint;
    throw err;
  }
  throw new Error('expected a UniqueViolation');
}

beforeEach(() => {
  repo = createMemoryRepo();
});

describe('memory repo', () => {
  it('creates and finds a league with defaults filled in', async () => {
    const { league } = await seed();
    expect(league.homeTeamNumber).toBe(5181);
    expect((await repo.getLeagueBySlug('fam-abc234'))?.id).toBe(league.id);
    expect(await repo.getLeagueBySlug('nope')).toBeNull();
  });

  it('rejects a duplicate slug', async () => {
    await seed();
    const dup = repo.createLeague({ slug: 'fam-abc234', name: 'x', adminTokenHash: 'h', defaultScoring: defaultScoring() });
    expect(await violation(dup)).toBe('leagues_slug_key');
  });

  it('rejects player names that differ only by case, on create and rename', async () => {
    const { league } = await seed();
    expect(await violation(repo.createPlayer(league.id, 'mom'))).toBe('players_league_name_ci');
    const dad = await repo.createPlayer(league.id, 'Dad');
    expect(await violation(repo.renamePlayer(dad.id, 'MOM'))).toBe('players_league_name_ci');
    expect((await repo.renamePlayer(dad.id, 'dad')).name).toBe('dad'); // renaming to own name is fine
  });

  it('creates rounds with the schema defaults', async () => {
    const { round } = await seed();
    expect(round).toMatchObject({ rosterSize: 4, draftOrder: [], finalizedAt: null });
  });

  it('rejects the same event twice in one league', async () => {
    const { league } = await seed();
    const dup = repo.createRound({
      leagueId: league.id, eventKey: '2025parr', eventName: 'x',
      startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    expect(await violation(dup)).toBe('rounds_league_event_key');
  });

  it('enforces one owner per team and one pick per pick number', async () => {
    const { round, mom } = await seed();
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc341' });
    expect(
      await violation(repo.insertPick({ roundId: round.id, pickNumber: 1, playerId: mom.id, teamKey: 'frc341' })),
    ).toBe('picks_round_team_key');
    expect(
      await violation(repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc25' })),
    ).toBe('picks_round_pick_number_key');
  });

  it('rejects replacing a pick with a team that is already taken', async () => {
    const { round, mom } = await seed();
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc341' });
    await repo.insertPick({ roundId: round.id, pickNumber: 1, playerId: mom.id, teamKey: 'frc25' });
    expect(await violation(repo.updatePickTeam(round.id, 1, 'frc341'))).toBe('picks_round_team_key');
    expect((await repo.updatePickTeam(round.id, 1, 'frc1')).teamKey).toBe('frc1');
  });

  it('lists picks in pick order', async () => {
    const { round, mom } = await seed();
    await repo.insertPick({ roundId: round.id, pickNumber: 1, playerId: mom.id, teamKey: 'frc25' });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc341' });
    expect((await repo.listPicks(round.id)).map((p) => p.pickNumber)).toEqual([0, 1]);
  });

  it('deleting a round removes its picks, adjustments, and extra teams', async () => {
    const { round, mom } = await seed();
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc341' });
    await repo.insertAdjustment({ roundId: round.id, playerId: mom.id, teamKey: null, points: 5, reason: 'x' });
    await repo.addExtraTeam(round.id, 'frc9999');
    await repo.deleteRound(round.id);
    expect(await repo.getRound(round.id)).toBeNull();
    expect(await repo.listPicks(round.id)).toEqual([]);
    expect(await repo.listAdjustments(round.id)).toEqual([]);
    expect(await repo.listExtraTeams(round.id)).toEqual([]);
  });

  it('adding the same extra team twice keeps one copy', async () => {
    const { round } = await seed();
    await repo.addExtraTeam(round.id, 'frc9999');
    await repo.addExtraTeam(round.id, 'frc9999');
    expect(await repo.listExtraTeams(round.id)).toEqual(['frc9999']);
  });

  it('returns copies, so callers cannot change stored rows by accident', async () => {
    const { round } = await seed();
    const fetched = (await repo.getRound(round.id))!;
    fetched.draftOrder.push('x');
    expect((await repo.getRound(round.id))!.draftOrder).toEqual([]);
  });

  it('stores and replaces cache rows', async () => {
    const row = { path: '/event/x', etag: 'a', body: { n: 1 }, fetchedAt: '2026-01-01T00:00:00.000Z', lastError: null, lastErrorAt: null };
    await repo.upsertCache(row);
    await repo.upsertCache({ ...row, etag: 'b', body: null });
    expect(await repo.getCache('/event/x')).toEqual({ ...row, etag: 'b', body: null });
    expect(await repo.getCache('/other')).toBeNull();
  });
});

describe('v2 league and player fields (SP1)', () => {
  it('gives every new league an invite code, link visibility, and no admin token', async () => {
    const repo = createMemoryRepo();
    const league = await repo.createLeague({ slug: 'fam-abc234', name: 'Fam', defaultScoring: defaultScoring() });
    expect(league.inviteCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    expect(league.visibility).toBe('link');
    expect(league.createdBy).toBeNull();
    expect(league.adminTokenHash).toBeNull();
  });

  it('keeps visibility and createdBy when given', async () => {
    const repo = createMemoryRepo();
    const league = await repo.createLeague({
      slug: 'fam-abc234', name: 'Fam', defaultScoring: defaultScoring(),
      visibility: 'members', createdBy: '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b',
    });
    expect(league.visibility).toBe('members');
    expect(league.createdBy).toBe('3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b');
  });

  it('makes name-only players unlinked plain players', async () => {
    const repo = createMemoryRepo();
    const league = await repo.createLeague({ slug: 'fam-abc234', name: 'Fam', defaultScoring: defaultScoring() });
    const mom = await repo.createPlayer(league.id, 'Mom');
    expect(mom.userId).toBeNull();
    expect(mom.role).toBe('player');
  });
});

describe('profiles and members (SP1)', () => {
  const USER = '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b';
  const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

  async function setup() {
    const repo = createMemoryRepo();
    const profile = await repo.createProfile({ id: USER, displayName: 'Joey', avatarUrl: null });
    const league = await repo.createLeague({
      slug: 'fam-abc234', name: 'Fam', defaultScoring: defaultScoring(), createdBy: USER,
    });
    return { repo, profile, league };
  }

  it('creates a profile once and returns the existing one on a repeat', async () => {
    const { repo } = await setup();
    const again = await repo.createProfile({ id: USER, displayName: 'Changed', avatarUrl: 'x' });
    expect(again.displayName).toBe('Joey');
    expect((await repo.getProfile(USER))!.frcTeam).toBeNull();
    expect(await repo.getProfile(OTHER)).toBeNull();
  });

  it('updates display name and FRC team', async () => {
    const { repo } = await setup();
    const saved = await repo.updateProfile(USER, { displayName: 'Joey H', frcTeam: 5181 });
    expect(saved).toMatchObject({ displayName: 'Joey H', frcTeam: 5181 });
    expect((await repo.updateProfile(USER, { frcTeam: null })).frcTeam).toBeNull();
  });

  it('creates a member, finds it by user, and lists the user’s leagues', async () => {
    const { repo, league } = await setup();
    const me = await repo.createMember({ leagueId: league.id, userId: USER, name: 'Joey', role: 'commissioner' });
    expect(me).toMatchObject({ userId: USER, role: 'commissioner', name: 'Joey' });
    expect((await repo.getMemberByUser(league.id, USER))!.id).toBe(me.id);
    expect(await repo.getMemberByUser(league.id, OTHER)).toBeNull();
    const mine = await repo.listLeaguesForUser(USER);
    expect(mine.map((m) => [m.league.slug, m.player.id])).toEqual([['fam-abc234', me.id]]);
  });

  it('refuses a second membership for the same user in one league', async () => {
    const { repo, league } = await setup();
    await repo.createMember({ leagueId: league.id, userId: USER, name: 'Joey', role: 'player' });
    await expect(
      repo.createMember({ leagueId: league.id, userId: USER, name: 'Joey 2', role: 'player' }),
    ).rejects.toMatchObject({ constraint: 'players_league_user' });
  });

  it('updates a player’s name, role, and unlinks them', async () => {
    const { repo, league } = await setup();
    const me = await repo.createMember({ leagueId: league.id, userId: USER, name: 'Joey', role: 'player' });
    expect((await repo.updatePlayer(me.id, { role: 'commissioner' })).role).toBe('commissioner');
    expect((await repo.updatePlayer(me.id, { name: 'J' })).name).toBe('J');
    const unlinked = await repo.updatePlayer(me.id, { userId: null });
    expect(unlinked.userId).toBeNull();
    expect(await repo.listLeaguesForUser(USER)).toEqual([]);
  });

  it('finds a league by invite code and resets it to a different code', async () => {
    const { repo, league } = await setup();
    expect((await repo.getLeagueByInviteCode(league.inviteCode))!.id).toBe(league.id);
    const reset = await repo.resetInviteCode(league.id);
    expect(reset.inviteCode).not.toBe(league.inviteCode);
    expect(await repo.getLeagueByInviteCode(league.inviteCode)).toBeNull();
  });

  it('counts leagues created by a user', async () => {
    const { repo } = await setup();
    await repo.createLeague({ slug: 'two-abc234', name: 'Two', defaultScoring: defaultScoring(), createdBy: USER });
    expect(await repo.countLeaguesCreatedBy(USER)).toBe(2);
    expect(await repo.countLeaguesCreatedBy(OTHER)).toBe(0);
  });

  it('deleting a user removes the profile and unlinks their rows', async () => {
    const { repo, league } = await setup();
    const me = await repo.createMember({ leagueId: league.id, userId: USER, name: 'Joey', role: 'commissioner' });
    await repo.deleteUser(USER);
    expect(await repo.getProfile(USER)).toBeNull();
    expect((await repo.listPlayers(league.id)).find((p) => p.id === me.id)!.userId).toBeNull();
    expect((await repo.getLeagueBySlug('fam-abc234'))!.createdBy).toBeNull();
  });
});
