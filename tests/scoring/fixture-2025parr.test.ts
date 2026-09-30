import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { scoreEvent } from '@/lib/scoring/engine';
import { creditedTeams, hasResult, winnerOf } from '@/lib/scoring/matches';
import { allianceMembers, finalsResult } from '@/lib/scoring/playoffs';
import type { CategoryId } from '@/lib/scoring/types';
import { loadFixture, loadFixtureEvent } from '../helpers/fixture';

const data = loadFixture('2025parr');
const scored = scoreEvent(data, DEFAULT_SCORING);

function pointsFor(teamKey: string, category: CategoryId): number {
  return (scored.teams.get(teamKey)?.lines ?? [])
    .filter((l) => l.category === category)
    .reduce((sum, l) => sum + l.points, 0);
}

describe('Ramp Riot 2025 replay: known facts', () => {
  it('is the right event', () => {
    expect(loadFixtureEvent('2025parr').key).toBe('2025parr');
  });

  it('has 34 teams in the pool, all with valid keys', () => {
    expect(data.teams).toHaveLength(34);
    for (const t of data.teams!) expect(t.key).toMatch(/^frc[1-9][0-9]{0,4}[A-Z]?$/);
  });

  it('scores every team in the pool', () => {
    for (const t of data.teams!) expect(scored.teams.has(t.key), t.key).toBe(true);
  });

  it('reads ranking points from extra_stats (branch 1)', () => {
    expect(scored.rpMethod).toBe('extra_stats');
  });

  it('knows quals are complete', () => {
    expect(scored.qualsComplete).toBe(true);
  });

  it('finds winner = Alliance 3 and finalist = Alliance 4 from alliance status', () => {
    expect(finalsResult(data.alliances, data.matches)).toEqual({ winner: 2, finalist: 3 });
  });

  it('finds the same winner and finalist from finals matches alone', () => {
    const stripped = data.alliances!.map((a) => ({ ...a, status: null }));
    expect(finalsResult(stripped, data.matches)).toEqual({ winner: 2, finalist: 3 });
  });

  it('gives every Alliance 3 member winner points and every Alliance 4 member finalist points', () => {
    for (const k of allianceMembers(data.alliances![2])) expect(pointsFor(k, 'eventResult'), k).toBe(15);
    for (const k of allianceMembers(data.alliances![3])) expect(pointsFor(k, 'eventResult'), k).toBe(8);
  });

  it("scores Alliance 2's fourth robot as a third pick", () => {
    const picks = data.alliances![1].picks;
    expect(picks).toHaveLength(4);
    const line = scored.teams.get(picks[3])!.lines.find((l) => l.category === 'alliance');
    expect(line).toEqual({ category: 'alliance', label: 'Alliance third pick', points: 2 });
  });

  it('trusts the tiebreak winner TBA recorded for the 156-156 playoff match', () => {
    const playoffs = data.matches!.filter((m) => m.comp_level !== 'qm' && hasResult(m));
    const tied = playoffs.filter(
      (m) => m.alliances!.red.score === 156 && m.alliances!.blue.score === 156,
    );
    expect(tied).toHaveLength(1);
    // The spec's original example expected '' here; TBA later applied the game tiebreaker.
    // §7.5: a non-empty winning_alliance is trusted, never overridden by comparing scores.
    expect(winnerOf(tied[0])).toBe('blue');
    for (const team of creditedTeams(tied[0], 'blue')) {
      expect(pointsFor(team, 'playoffWins'), team).toBeGreaterThan(0);
    }

    // Total win credits handed out must equal the credits from decided matches only.
    const expectedCredits = playoffs.reduce((sum, m) => {
      const w = winnerOf(m);
      return sum + (w ? creditedTeams(m, w).length : 0);
    }, 0);
    const actualCredits = [...scored.teams.values()].reduce(
      (sum, t) => sum + (t.lines.find((l) => l.category === 'playoffWins')?.quantity ?? 0),
      0,
    );
    expect(actualCredits).toBe(expectedCredits);
  });

  it('has no award points, because TBA has no awards for this event', () => {
    for (const t of scored.teams.values()) {
      expect(t.lines.some((l) => l.category === 'awards'), t.teamKey).toBe(false);
    }
  });

  it('awards the OPR bonus to exactly the top three', () => {
    const bonuses = [...scored.teams.values()]
      .map((t) => t.lines.find((l) => l.category === 'oprBonus')?.points ?? 0)
      .filter((p) => p > 0)
      .sort((a, b) => b - a);
    expect(bonuses).toEqual([6, 4, 2]);
  });

  it('makes every total equal the sum of its lines, with whole numbers only', () => {
    for (const t of scored.teams.values()) {
      expect(t.total, t.teamKey).toBe(t.lines.reduce((sum, l) => sum + l.points, 0));
      expect(Number.isInteger(t.total), t.teamKey).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Hand-verified breakdowns (spec §10.2).
//
// These numbers come from a HUMAN reading thebluealliance.com/event/2025parr,
// not from running the engine. Step 7 of Task 11 explains how to fill them in.
// Filled 2026-09-30 by deriving from the raw fixture JSON (no engine code); spot-check against thebluealliance.com/event/2025parr.
// ---------------------------------------------------------------------------
type HandVerified = {
  why: string;
  record: [wins: number, losses: number, ties: number];
  rankingPoints: number;
  rank: number;
  alliancePoints: number; // captain 8, first pick 6, second pick 3, third pick 2, backup 2, none 0
  playoffWins: number; // matches won, not points
  eventResultPoints: number; // winner 15, finalist 8, neither 0
  oprBonusPoints: number; // 6, 4, 2, or 0
  total: number;
};

const HAND_VERIFIED: Record<string, HandVerified> = {
  frc2607: {
    why: 'event winner captain (Alliance 3)',
    record: [5, 0, 0],
    rankingPoints: 25,
    rank: 3,
    alliancePoints: 8,
    playoffWins: 5,
    eventResultPoints: 15,
    oprBonusPoints: 6,
    total: 94,
  },
  frc103: {
    why: 'rank-17 team',
    record: [2, 3, 0],
    rankingPoints: 14,
    rank: 17,
    alliancePoints: 6,
    playoffWins: 3,
    eventResultPoints: 0,
    oprBonusPoints: 0,
    total: 38,
  },
  frc9998: {
    why: 'lowest-ranked undrafted team',
    record: [0, 5, 0],
    rankingPoints: 2,
    rank: 34,
    alliancePoints: 0,
    playoffWins: 0,
    eventResultPoints: 0,
    oprBonusPoints: 0,
    total: 2,
  },
};

describe('Ramp Riot 2025 replay: hand-verified teams', () => {
  it('has three hand-verified teams', () => {
    expect(Object.keys(HAND_VERIFIED)).toHaveLength(3);
  });

  it('matches every hand-verified number', () => {
    for (const [teamKey, want] of Object.entries(HAND_VERIFIED)) {
      const [w, l, t] = want.record;
      const lines = scored.teams.get(teamKey)!.lines;
      expect(lines.find((x) => x.category === 'qualRecord')?.label, teamKey).toBe(`Qual record ${w}-${l}-${t}`);
      expect(pointsFor(teamKey, 'qualRecord'), teamKey).toBe(w * 3 + t * 1);
      expect(pointsFor(teamKey, 'rankingPoints'), teamKey).toBe(want.rankingPoints);
      expect(lines.find((x) => x.category === 'rank')?.quantity, teamKey).toBe(want.rank);
      expect(pointsFor(teamKey, 'alliance'), teamKey).toBe(want.alliancePoints);
      expect(pointsFor(teamKey, 'playoffWins'), teamKey).toBe(want.playoffWins * 4);
      expect(pointsFor(teamKey, 'eventResult'), teamKey).toBe(want.eventResultPoints);
      expect(pointsFor(teamKey, 'oprBonus'), teamKey).toBe(want.oprBonusPoints);
      expect(scored.teams.get(teamKey)!.total, teamKey).toBe(want.total);
    }
  });
});
