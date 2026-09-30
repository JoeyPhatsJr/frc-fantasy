import { describe, expect, it } from 'vitest';
import { pickerFor, rankByTotal, roundPlayers, scoreRound, seasonStandings } from '@/lib/scoring/round';
import type { Adjustment, Pick, Player, TeamScore } from '@/lib/scoring/types';

const mom: Player = { id: 'p-mom', name: 'Mom' };
const dad: Player = { id: 'p-dad', name: 'Dad' };
const joey: Player = { id: 'p-joey', name: 'Joey' };
const gran: Player = { id: 'p-gran', name: 'Gran' };

function team(teamKey: string, total: number): TeamScore {
  return { teamKey, total, lines: total === 0 ? [] : [{ category: 'qualRecord', label: 'Qual record', points: total }] };
}

function scores(...teams: TeamScore[]): Map<string, TeamScore> {
  return new Map(teams.map((t) => [t.teamKey, t]));
}

function pick(pickNumber: number, player: Player, teamKey: string): Pick {
  return { pickNumber, playerId: player.id, teamKey };
}

function adj(a: Partial<Adjustment> & { points: number; reason: string }): Adjustment {
  return { id: `adj-${a.reason}`, playerId: null, teamKey: null, ...a };
}

describe('pickerFor (§3.2)', () => {
  const sequence = (order: string[], count: number) =>
    Array.from({ length: count }, (_, n) => pickerFor(n, order));

  it('P = 1', () => {
    expect(sequence(['a'], 3)).toEqual(['a', 'a', 'a']);
  });
  it('P = 2', () => {
    expect(sequence(['a', 'b'], 6)).toEqual(['a', 'b', 'b', 'a', 'a', 'b']);
  });
  it('P = 3', () => {
    expect(sequence(['a', 'b', 'c'], 9)).toEqual(['a', 'b', 'c', 'c', 'b', 'a', 'a', 'b', 'c']);
  });
  it('P = 5', () => {
    expect(sequence(['a', 'b', 'c', 'd', 'e'], 12)).toEqual([
      'a', 'b', 'c', 'd', 'e', 'e', 'd', 'c', 'b', 'a', 'a', 'b',
    ]);
  });
  it('throws on an empty order or a bad pick number', () => {
    expect(() => pickerFor(0, [])).toThrow();
    expect(() => pickerFor(-1, ['a'])).toThrow();
    expect(() => pickerFor(1.5, ['a'])).toThrow();
  });
});

describe('rankByTotal (§3.6)', () => {
  it('sorts descending and shares ranks on ties: 1, 1, 3', () => {
    const out = rankByTotal([
      { name: 'Mom', total: 50 },
      { name: 'Joey', total: 80 },
      { name: 'dad', total: 80 },
    ]);
    expect(out.map((r) => [r.name, r.rank])).toEqual([
      ['dad', 1],
      ['Joey', 1],
      ['Mom', 3],
    ]);
  });
  it('handles an empty list', () => {
    expect(rankByTotal([])).toEqual([]);
  });
});

describe('roundPlayers', () => {
  it('returns draft-order players in draft order', () => {
    expect(roundPlayers([mom, dad, joey], [joey.id, mom.id], [])).toEqual([joey, mom]);
  });
  // Review Focus 5
  it('adds a player who only has an adjustment', () => {
    const out = roundPlayers([mom, dad, joey], [joey.id], [adj({ playerId: dad.id, points: 5, reason: 'bet' })]);
    expect(out).toEqual([joey, dad]);
  });
  it('skips ids that are not league players', () => {
    expect(roundPlayers([mom], ['ghost', mom.id], [])).toEqual([mom]);
  });
});

describe('scoreRound', () => {
  it('sums each player\'s drafted teams, in pick order', () => {
    const out = scoreRound(
      scores(team('frc1', 40), team('frc2', 10), team('frc3', 25)),
      [pick(0, mom, 'frc1'), pick(1, dad, 'frc3'), pick(2, dad, 'frc2')],
      [],
      [mom, dad],
    );
    expect(out.map((p) => [p.name, p.total, p.rank])).toEqual([
      ['Mom', 40, 1],
      ['Dad', 35, 2],
    ]);
    expect(out[1].teams.map((t) => t.teamKey)).toEqual(['frc3', 'frc2']);
  });

  it('adds a team-targeted adjustment to the owning player, as a line on that team', () => {
    const out = scoreRound(
      scores(team('frc1', 40)),
      [pick(0, mom, 'frc1')],
      [adj({ teamKey: 'frc1', points: 5, reason: 'Industrial Design Award' })],
      [mom, dad],
    );
    const momRow = out.find((p) => p.playerId === mom.id)!;
    expect(momRow.total).toBe(45);
    expect(momRow.teams[0].total).toBe(45);
    expect(momRow.teams[0].lines.at(-1)).toEqual({
      category: 'adjustment',
      label: 'Adjustment: Industrial Design Award',
      points: 5,
    });
    expect(out.find((p) => p.playerId === dad.id)!.total).toBe(0);
  });

  it('does not mutate the event scores it was given', () => {
    const eventScores = scores(team('frc1', 40));
    scoreRound(eventScores, [pick(0, mom, 'frc1')], [adj({ teamKey: 'frc1', points: 5, reason: 'x' })], [mom]);
    expect(eventScores.get('frc1')!.total).toBe(40);
    expect(eventScores.get('frc1')!.lines).toHaveLength(1);
  });

  it('ignores a team-targeted adjustment on an undrafted team', () => {
    const out = scoreRound(
      scores(team('frc1', 40), team('frc9', 3)),
      [pick(0, mom, 'frc1')],
      [adj({ teamKey: 'frc9', points: 50, reason: 'nobody owns this' })],
      [mom],
    );
    expect(out[0].total).toBe(40);
  });

  it('adds player-targeted adjustments, including negative ones', () => {
    const out = scoreRound(
      scores(team('frc1', 40)),
      [pick(0, mom, 'frc1')],
      [adj({ playerId: mom.id, points: -10, reason: 'Late to draft' })],
      [mom],
    );
    expect(out[0].total).toBe(30);
    expect(out[0].adjustments).toEqual([
      { category: 'adjustment', label: 'Adjustment: Late to draft', points: -10 },
    ]);
  });

  // Review Focus 5
  it('scores an adjustment for a player who is not in the draft order', () => {
    const adjustments = [adj({ playerId: gran.id, points: 7, reason: 'Guessed the winner' })];
    const players = roundPlayers([mom, gran], [mom.id], adjustments);
    const out = scoreRound(scores(team('frc1', 40)), [pick(0, mom, 'frc1')], adjustments, players);
    expect(out.map((p) => [p.name, p.total])).toEqual([
      ['Mom', 40],
      ['Gran', 7],
    ]);
  });

  it('gives 0 to a participating player with no picks yet', () => {
    const out = scoreRound(scores(team('frc1', 40)), [pick(0, mom, 'frc1')], [], [mom, dad]);
    expect(out.find((p) => p.playerId === dad.id)).toMatchObject({ total: 0, teams: [], rank: 2 });
  });

  it('scores a drafted team with no event data as 0', () => {
    const out = scoreRound(new Map(), [pick(0, mom, 'frc9999')], [], [mom]);
    expect(out[0].teams).toEqual([{ teamKey: 'frc9999', total: 0, lines: [] }]);
    expect(out[0].total).toBe(0);
  });

  it('shares a rank on ties and orders the tie alphabetically', () => {
    const out = scoreRound(
      scores(team('frc1', 20), team('frc2', 20), team('frc3', 5)),
      [pick(0, mom, 'frc1'), pick(1, dad, 'frc2'), pick(2, joey, 'frc3')],
      [],
      [mom, dad, joey],
    );
    expect(out.map((p) => [p.name, p.rank])).toEqual([
      ['Dad', 1],
      ['Mom', 1],
      ['Joey', 3],
    ]);
  });
});

describe('seasonStandings', () => {
  it('sums rounds, with 0 for a round a player skipped', () => {
    const round1 = scoreRound(
      scores(team('frc1', 40), team('frc2', 10)),
      [pick(0, mom, 'frc1'), pick(1, dad, 'frc2')],
      [],
      [mom, dad],
    );
    const round2 = scoreRound(scores(team('frc3', 25)), [pick(0, dad, 'frc3')], [], [dad]);
    const out = seasonStandings([mom, dad, joey], [round1, round2]);
    expect(out).toEqual([
      { playerId: mom.id, name: 'Mom', total: 40, rank: 1, perRound: [40, 0] },
      { playerId: dad.id, name: 'Dad', total: 35, rank: 2, perRound: [10, 25] },
      { playerId: joey.id, name: 'Joey', total: 0, rank: 3, perRound: [0, 0] },
    ]);
  });

  it('works with no rounds', () => {
    expect(seasonStandings([mom], [])).toEqual([
      { playerId: mom.id, name: 'Mom', total: 0, rank: 1, perRound: [] },
    ]);
  });
});
