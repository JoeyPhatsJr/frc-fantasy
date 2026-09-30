import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, PlayerRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import type { EventData } from '@/lib/tba/types';
import { loadLeaguePage } from '@/lib/views/league';
import { cleanEventData, loadRoundPage } from '@/lib/views/round';
import { seedLeague } from '../helpers/api';
import { emptyEvent, match, rankRow, rankings } from '../helpers/builders';
import { createMemoryRepo } from '../helpers/memoryRepo';

const NOW = new Date('2026-10-01T16:00:00.000Z');
const A0 = ['frc1', 'frc2', 'frc3'];
const A1 = ['frc4', 'frc5', 'frc6'];

/** Quals under way: frc1 is 2-0 and rank 1, frc4 is 1-1 and rank 2. */
function eventInProgress(): EventData {
  return {
    ...emptyEvent(),
    teams: [...A0, ...A1].map((key) => ({ key, team_number: Number(key.slice(3)), nickname: `Team ${key.slice(3)}` })),
    rankings: rankings([
      rankRow(1, 'frc1', [2, 0, 0], { extra_stats: [7] }),
      rankRow(2, 'frc4', [1, 1, 0], { extra_stats: [4] }),
    ]),
    matches: [
      match({ num: 1, red: A0, blue: A1, redScore: 50, blueScore: 10 }),
      match({ num: 2, red: A0, blue: A1 }),
    ],
  };
}

/** Answers getTba by event key and endpoint. Unknown events have no data. */
function tba(events: Record<string, EventData>, opts: { stale?: boolean; fetchedAt?: string | null } = {}) {
  h.getTba = vi.fn(async (path: unknown) => {
    const m = /^\/event\/([^/]+)\/(teams|matches|rankings|alliances|awards|oprs)/.exec(String(path));
    const data = m ? (events[m[1]]?.[m[2] as keyof EventData] ?? null) : null;
    return {
      data,
      fetchedAt: opts.fetchedAt === undefined ? '2026-10-01T15:58:00.000Z' : opts.fetchedAt,
      stale: opts.stale ?? false,
    };
  });
}

let repo: Repo;
let league: LeagueRow;
let mom: PlayerRow;
let dad: PlayerRow;
let joey: PlayerRow;
let round: RoundRow;

async function newRound(eventKey: string, startDate: string) {
  return repo.createRound({
    leagueId: league.id, eventKey, eventName: `Event ${eventKey}`,
    startDate, endDate: startDate, timezone: 'America/New_York', scoring: defaultScoring(),
  });
}

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  ({ league } = await seedLeague(repo));
  mom = await repo.createPlayer(league.id, 'Mom');
  dad = await repo.createPlayer(league.id, 'Dad');
  joey = await repo.createPlayer(league.id, 'Joey');
  round = await newRound('2025parr', '2025-10-25');
  round = await repo.updateRound(round.id, { draftOrder: [mom.id, dad.id], rosterSize: 1 });
  await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc1' });
  await repo.insertPick({ roundId: round.id, pickNumber: 1, playerId: dad.id, teamKey: 'frc4' });
  await repo.insertAdjustment({ roundId: round.id, playerId: null, teamKey: 'frc1', points: 5, reason: 'Award' });
  tba({ '2025parr': eventInProgress() });
});

describe('loadRoundPage', () => {
  it('scores the round from TBA data, picks, and adjustments', async () => {
    const page = (await loadRoundPage(league.slug, round.id, NOW))!;
    expect(page.league).toEqual({ slug: league.slug, name: 'Habich Fam' });
    // frc1: 2 wins (6) + 7 RP + rank #1 (10) + adjustment 5 = 28. frc4: 3 + 4 + 5 = 12.
    expect(page.view.scores.map((s) => [s.name, s.total, s.rank])).toEqual([
      ['Mom', 28, 1],
      ['Dad', 12, 2],
    ]);
    expect(page.view.status).toBe('awaiting_final');
    expect(page.view.qualsComplete).toBe(false);
    expect(page.view.rpMethod).toBe('extra_stats');
    expect(page.view.hasEventData).toBe(true);
    expect(page.view.teamNames.frc1).toBe('Team 1');
    expect(page.view.fetchedAt).toBe('2026-10-01T15:58:00.000Z');
    expect(page.view.stale).toBe(false);
  });

  it('names every league player, including ones not in this round', async () => {
    const page = (await loadRoundPage(league.slug, round.id, NOW))!;
    expect(page.playerNames).toEqual({ [mom.id]: 'Mom', [dad.id]: 'Dad', [joey.id]: 'Joey' });
  });

  it('never exposes the admin token hash', async () => {
    const page = (await loadRoundPage(league.slug, round.id, NOW))!;
    expect(JSON.stringify(page)).not.toContain(league.adminTokenHash);
  });

  it('uses the round cache window when calling TBA', async () => {
    await loadRoundPage(league.slug, round.id, NOW);
    const calls = (h.getTba as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(6);
    for (const call of calls) expect(call[1]).toEqual({ windowMs: 10 * 60_000 }); // long after the event
  });

  it('shows zeros and "no event data" before the event has any results', async () => {
    tba({});
    const page = (await loadRoundPage(league.slug, round.id, NOW))!;
    expect(page.view.hasEventData).toBe(false);
    expect(page.view.scores.map((s) => [s.name, s.total])).toEqual([
      ['Mom', 5], // only the adjustment
      ['Dad', 0],
    ]);
  });

  it('passes the stale flag through', async () => {
    tba({ '2025parr': eventInProgress() }, { stale: true });
    const page = (await loadRoundPage(league.slug, round.id, NOW))!;
    expect(page.view.stale).toBe(true);
    expect(page.view.scores[0].total).toBe(28); // still shows the last good data
  });

  // Review Focus 3
  it('returns null for a bad id, an unknown league, or a round from another league', async () => {
    expect(await loadRoundPage(league.slug, 'not-a-uuid', NOW)).toBeNull();
    expect(await loadRoundPage(league.slug, '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b', NOW)).toBeNull();
    expect(await loadRoundPage('no-such-league', round.id, NOW)).toBeNull();
    const other = await seedLeague(repo, { slug: 'other-league-bbbbbb' });
    expect(await loadRoundPage(other.league.slug, round.id, NOW)).toBeNull();
  });
});

describe('cleanEventData', () => {
  it('replaces wrongly shaped sections with null so scoring cannot crash', () => {
    const broken = {
      teams: { Error: 'nope' },
      matches: 'oops',
      rankings: [],
      alliances: {},
      awards: 5,
      oprs: [],
    } as unknown as EventData;
    expect(cleanEventData(broken)).toEqual(emptyEvent());
  });

  it('keeps correctly shaped sections', () => {
    const good = eventInProgress();
    expect(cleanEventData(good)).toEqual(good);
  });
});

describe('loadLeaguePage', () => {
  it('adds rounds into season standings, including players who skipped a round', async () => {
    const round2 = await newRound('2026parr', '2026-10-24');
    await repo.updateRound(round2.id, { draftOrder: [joey.id], rosterSize: 1 });
    await repo.insertPick({ roundId: round2.id, pickNumber: 0, playerId: joey.id, teamKey: 'frc4' });
    tba({ '2025parr': eventInProgress(), '2026parr': eventInProgress() });

    const page = (await loadLeaguePage(league.slug, NOW))!;
    expect(page.league).toEqual({ slug: league.slug, name: 'Habich Fam' });
    expect(page.rounds.map((r) => r.round.eventKey)).toEqual(['2025parr', '2026parr']);
    expect(page.standings).toEqual([
      { playerId: mom.id, name: 'Mom', total: 28, rank: 1, perRound: [28, 0] },
      { playerId: dad.id, name: 'Dad', total: 12, rank: 2, perRound: [12, 0] },
      { playerId: joey.id, name: 'Joey', total: 12, rank: 2, perRound: [0, 12] },
    ]);
    expect(page.anyLive).toBe(false);
  });

  it('knows when a round is live', async () => {
    const live = await newRound('2026parr', '2026-10-01');
    await repo.updateRound(live.id, { draftOrder: [joey.id], rosterSize: 1 });
    await repo.insertPick({ roundId: live.id, pickNumber: 0, playerId: joey.id, teamKey: 'frc4' });
    const page = (await loadLeaguePage(league.slug, NOW))!;
    expect(page.anyLive).toBe(true);
    expect(page.rounds.find((r) => r.round.id === live.id)!.status).toBe('live');
  });

  it('reports the oldest fetch time and any staleness', async () => {
    tba({ '2025parr': eventInProgress() }, { stale: true, fetchedAt: '2026-10-01T15:00:00.000Z' });
    const page = (await loadLeaguePage(league.slug, NOW))!;
    expect(page.fetchedAt).toBe('2026-10-01T15:00:00.000Z');
    expect(page.stale).toBe(true);
  });

  it('works for a league with no rounds or players', async () => {
    const empty = await seedLeague(repo, { slug: 'empty-league-cccccc', name: 'Empty' });
    const page = (await loadLeaguePage(empty.league.slug, NOW))!;
    expect(page).toMatchObject({ standings: [], rounds: [], anyLive: false, fetchedAt: null, stale: false });
    expect(h.getTba).not.toHaveBeenCalled();
  });

  it('returns null for an unknown league', async () => {
    expect(await loadLeaguePage('no-such-league', NOW)).toBeNull();
  });
});
