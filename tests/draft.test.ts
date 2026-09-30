import { describe, expect, it } from 'vitest';
import { availableTeams, draftBanner, moveItem, shuffled } from '@/lib/draft';
import type { PoolTeam } from '@/lib/teams';

const names = { mom: 'Mom', dad: 'Dad', joey: 'Joey' };
const order = ['mom', 'dad', 'joey'];

describe('draftBanner (§5.5)', () => {
  it('says whose turn it is, which pick, and which draft round', () => {
    expect(draftBanner({ pickCount: 0, draftOrder: order, rosterSize: 2, playerNames: names })).toBe(
      "Pick 1 of 6 — Mom's turn (round 1)",
    );
    expect(draftBanner({ pickCount: 3, draftOrder: order, rosterSize: 2, playerNames: names })).toBe(
      "Pick 4 of 6 — Joey's turn (round 2)", // snake: round 2 goes Joey, Dad, Mom
    );
    expect(draftBanner({ pickCount: 5, draftOrder: order, rosterSize: 2, playerNames: names })).toBe(
      "Pick 6 of 6 — Mom's turn (round 2)",
    );
  });
  it('knows when the draft is complete or not set up', () => {
    expect(draftBanner({ pickCount: 6, draftOrder: order, rosterSize: 2, playerNames: names })).toBe(
      'Draft complete — 6 of 6 picks',
    );
    expect(draftBanner({ pickCount: 0, draftOrder: [], rosterSize: 2, playerNames: names })).toBe(
      'Set the draft order to start the draft',
    );
  });
});

describe('availableTeams', () => {
  const pool: PoolTeam[] = [
    { teamKey: 'frc341', label: '341', nickname: 'Miss Daisy', manual: false },
    { teamKey: 'frc3467', label: '3467', nickname: 'Windham Windup', manual: false },
    { teamKey: 'frc1234', label: '1234', nickname: null, manual: true },
    { teamKey: 'frc5181', label: '5181', nickname: 'Explorer Robotics', manual: false },
  ];

  it('hides drafted teams', () => {
    expect(availableTeams(pool, [{ teamKey: 'frc341' }], '').map((t) => t.teamKey)).toEqual([
      'frc3467', 'frc1234', 'frc5181',
    ]);
  });
  it('matches the start of a team number', () => {
    expect(availableTeams(pool, [], '34').map((t) => t.label)).toEqual(['341', '3467']);
    expect(availableTeams(pool, [], '234')).toEqual([]);
  });
  it('matches anywhere in the nickname, ignoring case', () => {
    expect(availableTeams(pool, [], 'DAISY').map((t) => t.label)).toEqual(['341']);
    expect(availableTeams(pool, [], 'robot').map((t) => t.label)).toEqual(['5181']);
  });
  it('ignores surrounding spaces and shows everything for an empty query', () => {
    expect(availableTeams(pool, [], '  341 ')).toHaveLength(1);
    expect(availableTeams(pool, [], '   ')).toHaveLength(4);
  });
});

describe('moveItem', () => {
  it('moves an item up or down and returns a new list', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(list, 2, -1)).toEqual(['a', 'c', 'b']);
    expect(list).toEqual(['a', 'b', 'c']);
  });
  it('does nothing at the edges', () => {
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});

describe('shuffled', () => {
  it('returns a permutation and leaves the input alone', () => {
    const list = [1, 2, 3, 4, 5];
    const out = shuffled(list, () => 0.5);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(list).toEqual([1, 2, 3, 4, 5]);
  });
  it('can change the order', () => {
    let i = 0;
    const seq = [0.9, 0.1, 0.7, 0.3];
    expect(shuffled([1, 2, 3, 4, 5], () => seq[i++ % seq.length])).not.toEqual([1, 2, 3, 4, 5]);
  });
});
