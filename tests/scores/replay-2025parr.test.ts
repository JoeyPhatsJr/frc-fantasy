import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));

import type { Repo } from '@/lib/db/repo';
import type { PlayerRow } from '@/lib/db/types';
import { DEFAULT_SCORING, defaultScoring } from '@/lib/scoring/config';
import { scoreEvent } from '@/lib/scoring/engine';
import { roundPlayers, scoreRound } from '@/lib/scoring/round';
import { getEventScores } from '@/lib/scores/eventScores';
import { configHash } from '@/lib/scores/hash';
import { cleanEventData } from '@/lib/tba/clean';
import type { EventData } from '@/lib/tba/types';
import { buildRoundView } from '@/lib/views/round';
import { seedLeague } from '../helpers/api';
import { loadFixture } from '../helpers/fixture';
import { createMemoryRepo } from '../helpers/memoryRepo';

const NOW = new Date('2026-10-01T16:00:00.000Z');
const fixture = loadFixture('2025parr');
const SUFFIX: Record<string, keyof EventData> = {
  'teams/simple': 'teams',
  'matches/simple': 'matches',
  rankings: 'rankings',
  alliances: 'alliances',
  awards: 'awards',
  oprs: 'oprs',
};

let repo: Repo;
let calls: string[];
let getCacheCalls: number;
const fetchImpl = (async (url: string | URL | Request) => {
  const u = String(url);
  calls.push(u);
  const name = SUFFIX[/\/event\/2025parr\/(.+)$/.exec(u)![1]];
  return new Response(JSON.stringify(fixture[name]), { status: 200, headers: { etag: '"fixture"' } });
}) as typeof fetch;

beforeEach(() => {
  const inner = createMemoryRepo();
  getCacheCalls = 0;
  repo = {
    ...inner,
    getCache: (p) => {
      getCacheCalls += 1;
      return inner.getCache(p);
    },
  };
  h.repo = repo;
  calls = [];
  vi.stubGlobal('fetch', fetchImpl);
  vi.stubEnv('TBA_API_KEY', 'test-key');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const expected = scoreEvent(cleanEventData(fixture), DEFAULT_SCORING);

describe('2025parr replay through getEventScores (spec §5.6)', () => {
  it('equals v1 scoreEvent output on a miss and on a hit', async () => {
    const miss = await getEventScores('2025parr', DEFAULT_SCORING, 10 * 60_000, { now: NOW });
    expect(calls).toHaveLength(6);
    expect(miss.scores).toEqual(expected);

    getCacheCalls = 0;
    const hit = await getEventScores('2025parr', DEFAULT_SCORING, 10 * 60_000, { now: NOW });
    expect(calls).toHaveLength(6); // no new TBA requests
    expect(getCacheCalls).toBe(0); // no TBA bodies read
    expect(hit.scores).toEqual(expected);
    expect(hit.info.teamNames.frc2607).toBeTruthy();
    expect(Object.keys(hit.info.teamNames)).toHaveLength(34);
  });

  it('gives the round page exactly the v1 player scores', async () => {
    const { league } = await seedLeague(repo);
    const players: PlayerRow[] = [];
    for (const name of ['Mom', 'Dad']) {
      players.push(await repo.createMember({ leagueId: league.id, userId: randomUUID(), name, role: 'player' }));
    }
    let round = await repo.createRound({
      leagueId: league.id,
      eventKey: '2025parr',
      eventName: 'Ramp Riot XXV',
      startDate: '2025-10-18',
      endDate: '2025-10-18',
      timezone: 'America/New_York',
      scoring: defaultScoring(),
    });
    round = await repo.updateRound(round.id, { draftOrder: players.map((p) => p.id), rosterSize: 2 });
    // Snake: Mom, Dad, Dad, Mom. Winner captain, finalist captain, OPR #2, a third pick.
    const teams = ['frc2607', 'frc316', 'frc9015', 'frc9991'];
    for (let n = 0; n < teams.length; n++) {
      await repo.insertPick({ roundId: round.id, pickNumber: n, playerId: [0, 1, 1, 0].map((i) => players[i].id)[n], teamKey: teams[n] });
    }
    const picks = await repo.listPicks(round.id);

    const view = await buildRoundView(round, players, picks, [], NOW);

    expect(view.scores).toEqual(scoreRound(expected.teams, picks, [], roundPlayers(players, round.draftOrder, [])));
    expect(view.qualsComplete).toBe(true);
    expect(view.rpMethod).toBe('extra_stats');
    expect(view.hasRankings).toBe(true);
    expect(view.stale).toBe(false);
    // The page went through the cache, so the next view is a cheap hit.
    expect(await repo.getEventScoresRow('2025parr', configHash(DEFAULT_SCORING))).not.toBeNull();
  });
});
