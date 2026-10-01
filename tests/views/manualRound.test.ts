import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { loadLeaguePage } from '@/lib/views/league';
import { loadRoundPage } from '@/lib/views/round';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

const NOW = new Date('2026-11-09T12:00:00.000Z');
let repo: Repo;
let league: LeagueRow;
let round: RoundRow;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  h.getTba = vi.fn(async () => {
    throw new Error('a manual round must never call TBA');
  });
  ({ league } = await seedLeague(repo));
  round = await repo.createRound({
    leagueId: league.id, eventKey: null, kind: 'manual', eventName: 'Garage Games',
    startDate: '2026-11-07', endDate: '2026-11-07', timezone: 'America/New_York', scoring: defaultScoring(),
  });
});

describe('a manual round page', () => {
  it('shows "no data" and zero points before results are typed in', async () => {
    const page = await loadRoundPage(league.slug, round.id, NOW);
    expect(page!.view).toMatchObject({ hasEventData: false, hasRankings: false, qualsComplete: false, rpMethod: 'manual', stale: false });
  });

  it('scores drafted teams from the typed-in results', async () => {
    const mom = await repo.createMember({ leagueId: league.id, userId: crypto.randomUUID(), name: 'Mom', role: 'player' });
    await repo.addExtraTeam(round.id, 'frc5181');
    await repo.updateRound(round.id, { draftOrder: [mom.id], rosterSize: 1 });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc5181' });
    await repo.upsertManualResult({
      roundId: round.id, teamKey: 'frc5181', qualWins: 5, qualLosses: 1, qualTies: 0, rankingPoints: null,
      qualRank: 2, allianceRole: 'captain', playoffWins: 0, eventResult: null, awardTypes: [],
    });
    const page = await loadRoundPage(league.slug, round.id, NOW);
    const momScore = page!.view.scores.find((s) => s.playerId === mom.id)!;
    expect(momScore.total).toBe(5 * 3 + 5 + 8); // record + rank 2 tier + captain
    expect(page!.view).toMatchObject({ hasEventData: true, hasRankings: true, qualsComplete: true });
  });

  it('counts toward season standings on the league page', async () => {
    const mom = await repo.createMember({ leagueId: league.id, userId: crypto.randomUUID(), name: 'Mom', role: 'player' });
    await repo.addExtraTeam(round.id, 'frc5181');
    await repo.updateRound(round.id, { draftOrder: [mom.id], rosterSize: 1 });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc5181' });
    await repo.upsertManualResult({
      roundId: round.id, teamKey: 'frc5181', qualWins: 5, qualLosses: 1, qualTies: 0, rankingPoints: null,
      qualRank: 2, allianceRole: 'captain', playoffWins: 0, eventResult: null, awardTypes: [],
    });
    const page = await loadLeaguePage(league.slug, NOW);
    expect(page!.standings.find((r) => r.playerId === mom.id)!.total).toBe(28);
    expect(page).toMatchObject({ fetchedAt: null, stale: false });
  });

  it('never reads or writes the event_scores cache (spec §5.3)', async () => {
    const read = vi.spyOn(repo, 'getEventScoresRow');
    const write = vi.spyOn(repo, 'upsertEventScoresRow');
    await repo.upsertManualResult({
      roundId: round.id, teamKey: 'frc5181', qualWins: 1, qualLosses: 0, qualTies: 0, rankingPoints: null,
      qualRank: null, allianceRole: null, playoffWins: 0, eventResult: null, awardTypes: [],
    });
    const page = await loadRoundPage(league.slug, round.id, NOW);
    expect(page!.view).toMatchObject({ hasEventData: true, hasRankings: false, fetchedAt: null, stale: false, teamNames: {} });
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});

describe('a season round page with no drafted teams', () => {
  it('has nothing to score, so it shows "no data" without calling TBA', async () => {
    const season = await repo.createRound({
      leagueId: league.id, eventKey: null, kind: 'season', seasonYear: 2027, eventName: '2027 season',
      startDate: '2027-01-01', endDate: '2027-04-30', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    const page = await loadRoundPage(league.slug, season.id, NOW);
    expect(page!.view).toMatchObject({ hasEventData: false, hasRankings: false, rpMethod: 'none', fetchedAt: null, stale: false });
  });
});
