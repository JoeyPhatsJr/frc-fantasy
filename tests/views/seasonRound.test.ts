import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  scoreSeasonRound: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/season/score', () => ({ scoreSeasonRound: (...args: unknown[]) => h.scoreSeasonRound(...args) }));

import type { Repo } from '@/lib/db/repo';
import { defaultScoring } from '@/lib/scoring/config';
import { loadRoundPage } from '@/lib/views/round';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

const NOW = new Date('2027-03-14T16:00:00.000Z');
let repo: Repo;

beforeEach(() => {
  repo = createMemoryRepo();
  h.repo = repo;
});

describe('a season round page', () => {
  it('scores drafted teams with scoreSeasonRound, keeps team adjustments, and exposes the per-event detail', async () => {
    const { league, commissioner } = await seedLeague(repo, { format: 'season' });
    const round = await repo.createRound({
      leagueId: league.id, eventKey: null, kind: 'season', seasonYear: 2027, eventName: '2027 Season',
      startDate: '2027-03-05', endDate: '2027-04-18', timezone: 'America/New_York', scoring: defaultScoring(), rosterSize: 1,
    });
    await repo.updateRound(round.id, { draftOrder: [commissioner.id] });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: commissioner.id, teamKey: 'frc5181' });
    await repo.insertAdjustment({ roundId: round.id, playerId: null, teamKey: 'frc5181', points: 5, reason: 'Spirit' });
    // scoreRound totals a team from its lines (v1), and scoreSeasonRound keeps total = sum of lines.
    const lines = [{ category: 'qualRecord' as const, label: 'Qual record 9-3-0', points: 41 }];
    const detail = {
      frc5181: { teamKey: 'frc5181', total: 41, events: [{ eventKey: '2027paca', name: 'Chesapeake', startDate: '2027-03-05', endDate: '2027-03-07', total: 41, lines, stale: false }], next: null },
    };
    h.scoreSeasonRound = vi.fn(async () => ({
      teams: new Map([['frc5181', { teamKey: 'frc5181', total: 41, lines }]]),
      detail,
      fetchedAt: '2027-03-14T15:58:00.000Z',
      stale: false,
    }));

    const page = await loadRoundPage(league.slug, round.id, NOW);
    expect(h.scoreSeasonRound).toHaveBeenCalledWith(expect.objectContaining({ id: round.id }), ['frc5181'], NOW);
    expect(page!.view.scores[0].total).toBe(46);
    expect(page!.view.season).toEqual(detail);
    expect(page!.view).toMatchObject({ hasEventData: true, fetchedAt: '2027-03-14T15:58:00.000Z' });
  });
});
