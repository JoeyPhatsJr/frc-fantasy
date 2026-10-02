import { describe, expect, it } from 'vitest';
import type { PickRow, RoundRow } from '@/lib/db/types';
import { statusesFromRows, targetFromRows } from '@/lib/rounds/targetFor';
import { defaultScoring } from '@/lib/scoring/config';

// Ramp Riot 2026 day, noon Eastern.
const NOW = new Date('2026-10-24T16:00:00Z');

const round = (id: string, startDate: string, over: Partial<RoundRow> = {}): RoundRow => ({
  id,
  leagueId: 'L',
  eventKey: null,
  eventName: id,
  startDate,
  endDate: startDate,
  timezone: 'America/New_York',
  rosterSize: 1,
  draftOrder: ['p1'],
  scoring: defaultScoring(),
  finalizedAt: null,
  draftMode: 'commissioner',
  pickSeconds: null,
  draftStartedAt: null,
  draftPausedAt: null,
  pausedRemainingMs: null,
  pickDeadline: null,
  kind: 'tba',
  seasonYear: null,
  poolFilter: null,
  autoAdded: false,
  autoFinalize: true,
  createdAt: '2026-09-01T00:00:00Z',
  ...over,
});

const pick = (roundId: string): PickRow => ({
  id: `${roundId}-1`,
  roundId,
  pickNumber: 1,
  playerId: 'p1',
  teamKey: 'frc5181',
  auto: false,
  createdAt: '2026-10-23T23:00:00Z',
});

describe('targetFromRows', () => {
  it('is null when the league has no rounds', () => {
    expect(targetFromRows([], [], NOW)).toBeNull();
  });

  it('picks the one live round among three', () => {
    const rounds = [
      round('old', '2026-09-12', { finalizedAt: '2026-09-14T00:00:00Z' }),
      round('live', '2026-10-24'),
      round('next', '2026-11-14'),
    ];
    // "live" is fully drafted and today is event day; "next" has no picks yet (setup).
    expect(targetFromRows(rounds, [pick('live')], NOW)).toBe('live');
  });
});

describe('statusesFromRows', () => {
  it('counts each round\'s own picks', () => {
    const rounds = [round('a', '2026-10-24'), round('b', '2026-10-24')];
    expect(statusesFromRows(rounds, [pick('a')], NOW).map((s) => s.status)).toEqual(['live', 'setup']);
  });
});
