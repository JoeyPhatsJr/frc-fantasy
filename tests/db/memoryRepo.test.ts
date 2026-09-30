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
