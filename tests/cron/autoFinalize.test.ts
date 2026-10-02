import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getTba: vi.fn() }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...a: unknown[]) => h.getTba(...a) }));

import { autoFinalizeRounds } from '@/lib/cron/autoFinalize';
import { DAILY_JOBS } from '@/lib/cron/jobs';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, PlayerRow, RoundKind, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

const DAY_AFTER = new Date('2026-10-25T10:00:00Z'); // 6 am Eastern, the day after a 2026-10-24 event
const BACKSTOP = new Date('2026-10-27T10:00:00Z');
const FAR = Number.MAX_SAFE_INTEGER;

let repo: Repo;
let league: LeagueRow;
let player: PlayerRow;

type Seed = { kind?: RoundKind; eventKey?: string | null; picks?: number; autoFinalize?: boolean; finalizedAt?: string };

/** A round for one player with 2 roster slots: 2 picks = draft complete. */
async function seed({ kind = 'tba', eventKey = '2026parr', picks = 2, autoFinalize, finalizedAt }: Seed = {}): Promise<RoundRow> {
  const round = await repo.createRound({
    leagueId: league.id,
    kind,
    eventKey: kind === 'tba' ? eventKey : null,
    seasonYear: kind === 'season' ? 2026 : null,
    eventName: eventKey ?? kind,
    startDate: '2026-10-24',
    endDate: '2026-10-24',
    timezone: 'America/New_York',
    scoring: defaultScoring(),
  });
  await repo.updateRound(round.id, { rosterSize: 2, draftOrder: [player.id], autoFinalize, finalizedAt });
  for (let n = 0; n < picks; n++) {
    await repo.insertPick({ roundId: round.id, pickNumber: n, playerId: player.id, teamKey: `frc${round.id.slice(0, 4)}${n}` });
  }
  return round;
}

const ok = (data: unknown) => ({ data, fetchedAt: '2026-10-25T09:00:00.000Z', stale: false });
const DECIDED = [
  { picks: ['frc1', 'frc2', 'frc3'], status: { level: 'f', status: 'won' } },
  { picks: ['frc4', 'frc5', 'frc6'], status: { level: 'f', status: 'eliminated' } },
];
const UNDECIDED = [
  { picks: ['frc1', 'frc2', 'frc3'], status: { level: 'f', status: 'playing' } },
  { picks: ['frc4', 'frc5', 'frc6'], status: { level: 'f', status: 'playing' } },
];

/** TBA answers per event key: alliances from the map, no matches. A key mapped to 'throw' rejects. */
function tba(byEvent: Record<string, unknown[] | 'throw'>) {
  h.getTba.mockImplementation(async (path: string) => {
    const key = path.split('/')[2];
    const answer = byEvent[key];
    if (answer === 'throw') throw new Error(`TBA down for ${key}`);
    return ok(path.endsWith('/alliances') ? (answer ?? null) : []);
  });
}

const stored = async (id: string) => (await repo.getRound(id))!;

beforeEach(async () => {
  h.getTba.mockReset();
  repo = createMemoryRepo();
  ({ league, commissioner: player } = await seedLeague(repo));
});

describe('autoFinalizeRounds (spec 2026-10-02 §5)', () => {
  it('finalizes a TBA round the day after once TBA shows a winner', async () => {
    const round = await seed();
    tba({ '2026parr': DECIDED });
    const s = await autoFinalizeRounds(repo, DAY_AFTER, FAR);
    expect(s.finalized).toEqual([round.id]);
    expect((await stored(round.id)).finalizedAt).toBe(DAY_AFTER.toISOString());
  });

  it('leaves a TBA round open the day after while the finals are undecided', async () => {
    const round = await seed();
    tba({ '2026parr': UNDECIDED });
    const s = await autoFinalizeRounds(repo, DAY_AFTER, FAR);
    expect(s.waitingOnFinals).toEqual([round.id]);
    expect((await stored(round.id)).finalizedAt).toBeNull();
  });

  it('backstop: finalizes manual, season and TBA rounds 3 days after without asking TBA', async () => {
    const manual = await seed({ kind: 'manual' });
    const season = await seed({ kind: 'season' });
    const event = await seed({ eventKey: '2026parr' });
    const s = await autoFinalizeRounds(repo, BACKSTOP, FAR);
    expect(new Set(s.finalized)).toEqual(new Set([manual.id, season.id, event.id]));
    expect(h.getTba).not.toHaveBeenCalled();
  });

  it('skips reopened, already-final and undrafted rounds', async () => {
    const reopened = await seed({ eventKey: '2026a', autoFinalize: false });
    const final = await seed({ eventKey: '2026b', finalizedAt: '2026-10-26T10:00:00.000Z' });
    const undrafted = await seed({ eventKey: '2026c', picks: 1 });
    const s = await autoFinalizeRounds(repo, BACKSTOP, FAR);
    expect(s).toEqual({ finalized: [], waitingOnFinals: [], errors: [] });
    expect((await stored(reopened.id)).finalizedAt).toBeNull();
    expect((await stored(final.id)).finalizedAt).toBe('2026-10-26T10:00:00.000Z');
    expect((await stored(undrafted.id)).finalizedAt).toBeNull();
    expect(h.getTba).not.toHaveBeenCalled();
  });

  it('one round failing to load from TBA does not stop the others', async () => {
    const broken = await seed({ eventKey: '2026brk' });
    const fine = await seed({ eventKey: '2026ok' });
    tba({ '2026brk': 'throw', '2026ok': DECIDED });
    const s = await autoFinalizeRounds(repo, DAY_AFTER, FAR);
    expect(s.finalized).toEqual([fine.id]);
    expect(s.errors).toEqual([{ roundId: broken.id, message: 'TBA down for 2026brk' }]);
    expect((await stored(broken.id)).finalizedAt).toBeNull();
  });

  it('starts no round once the deadline has passed', async () => {
    const round = await seed({ kind: 'manual' });
    const s = await autoFinalizeRounds(repo, BACKSTOP, 1, () => 2);
    expect(s).toEqual({ finalized: [], waitingOnFinals: [], errors: [] });
    expect((await stored(round.id)).finalizedAt).toBeNull();
  });
});

describe('DAILY_JOBS', () => {
  it('runs auto-finalize after season-dates (fresh season end dates) and before team-stats', () => {
    const names = DAILY_JOBS.map((j) => j.name);
    expect(names.indexOf('auto-finalize')).toBeGreaterThan(names.indexOf('season-dates'));
    expect(names.indexOf('auto-finalize')).toBeLessThan(names.indexOf('team-stats'));
  });
});
