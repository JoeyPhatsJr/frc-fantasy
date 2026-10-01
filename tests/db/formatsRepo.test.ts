import { beforeEach, describe, expect, it } from 'vitest';
import { UniqueViolation, type Repo } from '@/lib/db/repo';
import type { LeagueRow, ManualResultRow } from '@/lib/db/types';
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

const result = (roundId: string, teamKey: string, over: Partial<ManualResultRow> = {}): ManualResultRow => ({
  roundId,
  teamKey,
  qualWins: 0,
  qualLosses: 0,
  qualTies: 0,
  rankingPoints: null,
  qualRank: null,
  allianceRole: null,
  playoffWins: 0,
  eventResult: null,
  awardTypes: [],
  ...over,
});

describe('round kind checks (0005 rounds_kind_event_key / rounds_kind_season)', () => {
  it('rejects a tba round without an event key and a non-tba round with one', async () => {
    await expect(repo.createRound({ leagueId: league.id, eventKey: null, ...base })).rejects.toThrow(/rounds_kind_event_key/);
    await expect(
      repo.createRound({ leagueId: league.id, eventKey: '2026paca', kind: 'manual', ...base }),
    ).rejects.toThrow(/rounds_kind_event_key/);
  });

  it('rejects a season round without a year and a non-season round with one', async () => {
    await expect(
      repo.createRound({ leagueId: league.id, eventKey: null, kind: 'season', ...base }),
    ).rejects.toThrow(/rounds_kind_season/);
    await expect(
      repo.createRound({ leagueId: league.id, eventKey: null, kind: 'manual', seasonYear: 2027, ...base }),
    ).rejects.toThrow(/rounds_kind_season/);
    await expect(
      repo.createRound({ leagueId: league.id, eventKey: '2026paca', seasonYear: 2027, ...base }),
    ).rejects.toThrow(/rounds_kind_season/);
  });

  it('stores nothing when a check fails', async () => {
    await repo.createRound({ leagueId: league.id, eventKey: null, ...base }).catch(() => undefined);
    expect(await repo.listRounds(league.id)).toEqual([]);
  });
});

describe('manual results', () => {
  it('upserts, lists by team key, and deletes', async () => {
    const round = await repo.createRound({ leagueId: league.id, eventKey: null, kind: 'manual', ...base });
    await repo.upsertManualResult(result(round.id, 'frc5181', { qualWins: 3 }));
    await repo.upsertManualResult(result(round.id, 'frc341', { qualRank: 1 }));
    await repo.upsertManualResult(result(round.id, 'frc5181', { qualWins: 4, awardTypes: [0] }));
    const rows = await repo.listManualResults(round.id);
    expect(rows.map((r) => r.teamKey)).toEqual(['frc341', 'frc5181']);
    expect(rows[1]).toMatchObject({ qualWins: 4, awardTypes: [0] });
    await repo.deleteManualResult(round.id, 'frc341');
    expect((await repo.listManualResults(round.id)).map((r) => r.teamKey)).toEqual(['frc5181']);
  });

  it('go away with their round', async () => {
    const round = await repo.createRound({ leagueId: league.id, eventKey: null, kind: 'manual', ...base });
    await repo.upsertManualResult(result(round.id, 'frc5181'));
    await repo.deleteRound(round.id);
    expect(await repo.listManualResults(round.id)).toEqual([]);
  });
});

describe('follows and skipped events', () => {
  it('replaces the follow list and finds leagues that follow someone', async () => {
    await repo.setFollows(league.id, [5181, 341]);
    expect(await repo.listFollows(league.id)).toEqual([341, 5181]);
    expect((await repo.listLeaguesWithFollows()).map((l) => l.id)).toEqual([league.id]);
    await repo.setFollows(league.id, []);
    expect(await repo.listLeaguesWithFollows()).toEqual([]);
  });

  it('adds a skipped event once, however often it is added', async () => {
    await repo.addSkippedEvent(league.id, '2026paca');
    await repo.addSkippedEvent(league.id, '2026paca');
    expect(await repo.listSkippedEvents(league.id)).toEqual(['2026paca']);
  });
});

describe('createRoundIfAbsent (spec 5.4 "on conflict do nothing")', () => {
  it('creates the first time and returns null the second time, without throwing', async () => {
    const input = { leagueId: league.id, eventKey: '2026paca', autoAdded: true, ...base };
    const first = await repo.createRoundIfAbsent(input);
    expect(first?.autoAdded).toBe(true);
    expect(await repo.createRoundIfAbsent(input)).toBeNull();
    expect(await repo.listRounds(league.id)).toHaveLength(1);
  });

  it('two at the same moment still make one round (Review Focus 2)', async () => {
    const input = { leagueId: league.id, eventKey: '2026paca', autoAdded: true, ...base };
    const out = await Promise.all([repo.createRoundIfAbsent(input), repo.createRoundIfAbsent(input)]);
    expect(out.filter((r) => r !== null)).toHaveLength(1);
    expect(await repo.listRounds(league.id)).toHaveLength(1);
  });
});

describe('listOpenSeasonRounds', () => {
  it('returns unfinalized season rounds from every league', async () => {
    const season = await repo.createRound({ leagueId: league.id, eventKey: null, kind: 'season', seasonYear: 2027, ...base });
    const done = await repo.createRound({ leagueId: league.id, eventKey: null, kind: 'season', seasonYear: 2026, ...base });
    await repo.updateRound(done.id, { finalizedAt: '2026-05-01T00:00:00.000Z' });
    await repo.createRound({ leagueId: league.id, eventKey: '2025parr', ...base });
    expect((await repo.listOpenSeasonRounds()).map((r) => r.id)).toEqual([season.id]);
  });
});
