import { beforeEach, describe, expect, it } from 'vitest';
import { UniqueViolation, type Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;

const base = {
  eventName: 'x',
  startDate: '2026-10-24',
  endDate: '2026-10-24',
  timezone: 'America/New_York',
  scoring: defaultScoring(),
};

beforeEach(async () => {
  repo = createMemoryRepo();
  ({ league } = await seedLeague(repo));
});

describe('league format', () => {
  it('defaults to event and has never synced follows', () => {
    expect(league.format).toBe('event');
    expect(league.followsSyncedAt).toBeNull();
  });

  it('stores followsSyncedAt', async () => {
    const saved = await repo.updateLeague(league.id, { followsSyncedAt: '2026-10-01T10:00:00.000Z' });
    expect(saved.followsSyncedAt).toBe('2026-10-01T10:00:00.000Z');
  });
});

describe('round kinds', () => {
  it('a v1-style round is a tba round with no season fields', async () => {
    const round = await repo.createRound({ leagueId: league.id, eventKey: '2025parr', ...base });
    expect(round).toMatchObject({ kind: 'tba', eventKey: '2025parr', seasonYear: null, poolFilter: null, autoAdded: false });
  });

  it('two manual rounds (null event key) never collide', async () => {
    await repo.createRound({ leagueId: league.id, eventKey: null, kind: 'manual', ...base });
    const second = await repo.createRound({ leagueId: league.id, eventKey: null, kind: 'manual', ...base });
    expect(second.kind).toBe('manual');
    expect(await repo.listRounds(league.id)).toHaveLength(2);
  });

  it('a season round keeps its year, pool filter, roster size and order', async () => {
    const round = await repo.createRound({
      leagueId: league.id,
      eventKey: null,
      kind: 'season',
      seasonYear: 2027,
      poolFilter: { type: 'district', key: '2027fma' },
      rosterSize: 8,
      draftOrder: [],
      ...base,
    });
    expect(round).toMatchObject({ kind: 'season', seasonYear: 2027, rosterSize: 8, poolFilter: { type: 'district', key: '2027fma' } });
  });

  it('still rejects the same TBA event twice in one league', async () => {
    await repo.createRound({ leagueId: league.id, eventKey: '2025parr', ...base });
    await expect(repo.createRound({ leagueId: league.id, eventKey: '2025parr', ...base })).rejects.toBeInstanceOf(
      UniqueViolation,
    );
  });

  it('patches dates and pool filter', async () => {
    const round = await repo.createRound({ leagueId: league.id, eventKey: null, kind: 'season', seasonYear: 2027, ...base });
    const saved = await repo.updateRound(round.id, {
      startDate: '2027-02-26',
      endDate: '2027-04-18',
      poolFilter: { type: 'country', country: 'Canada' },
    });
    expect(saved).toMatchObject({ startDate: '2027-02-26', endDate: '2027-04-18', poolFilter: { type: 'country', country: 'Canada' } });
  });
});
