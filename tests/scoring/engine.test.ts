import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { scoreEvent } from '@/lib/scoring/engine';
import type { EventData } from '@/lib/tba/types';
import { alliance, emptyEvent, match, rankRow, rankings } from '../helpers/builders';

const A0 = ['frc1', 'frc2', 'frc3'];
const A1 = ['frc4', 'frc5', 'frc6'];

function finishedEvent(): EventData {
  return {
    teams: [...A0, ...A1, 'frc7'].map((key) => ({ key, team_number: Number(key.slice(3)), nickname: key })),
    rankings: rankings([
      rankRow(1, 'frc1', [2, 0, 0], { extra_stats: [7] }),
      rankRow(2, 'frc4', [1, 1, 0], { extra_stats: [4] }),
      rankRow(17, 'frc7', [0, 2, 0], { extra_stats: [0] }),
    ]),
    matches: [
      match({ num: 1, red: A0, blue: A1, redScore: 50, blueScore: 10 }),
      match({ level: 'f', set: 1, num: 1, red: A0, blue: A1, redScore: 50, blueScore: 10 }),
      match({ level: 'f', set: 1, num: 2, red: A0, blue: A1, redScore: 50, blueScore: 10 }),
    ],
    alliances: [
      alliance(A0, { status: { level: 'f', status: 'won' } }),
      alliance(A1, { status: { level: 'f', status: 'eliminated' } }),
    ],
    awards: [{ name: 'Industrial Design Award', award_type: 29, recipient_list: [{ team_key: 'frc1', awardee: null }] }],
    oprs: { oprs: { frc1: 40, frc4: 30, frc2: 20, frc7: 1 } },
  };
}

describe('scoreEvent', () => {
  it('stacks every category for the winning captain', () => {
    const { teams, qualsComplete, rpMethod } = scoreEvent(finishedEvent(), DEFAULT_SCORING);
    expect(qualsComplete).toBe(true);
    expect(rpMethod).toBe('extra_stats');
    const t = teams.get('frc1')!;
    expect(t.lines).toEqual([
      { category: 'qualRecord', label: 'Qual record 2-0-0', points: 6 },
      { category: 'rankingPoints', label: 'Ranking points 7', quantity: 7, points: 7 },
      { category: 'rank', label: 'Final rank #1', quantity: 1, points: 10 },
      { category: 'alliance', label: 'Alliance captain', points: 8 },
      { category: 'playoffWins', label: 'Playoff wins ×2', quantity: 2, points: 8 },
      { category: 'eventResult', label: 'Event winner', points: 15 },
      { category: 'awards', label: 'Industrial Design Award', points: 5 },
      { category: 'oprBonus', label: 'OPR rank #1', quantity: 1, points: 6 },
    ]);
    expect(t.total).toBe(6 + 7 + 10 + 8 + 8 + 15 + 5 + 6);
  });

  it('scores a finalist and an undrafted-looking low team', () => {
    const { teams } = scoreEvent(finishedEvent(), DEFAULT_SCORING);
    // frc4: record 1-1-0 (3) + RP 4 + rank #2 (5) + captain (8) + finalist (8) + OPR #2 (4)
    expect(teams.get('frc4')!.total).toBe(3 + 4 + 5 + 8 + 8 + 4);
    // frc7: record 0-2-0 (0) + RP 0 + rank #17 (0) + OPR #4 (0)
    expect(teams.get('frc7')!.total).toBe(0);
  });

  it('returns a score for every team that appears in any input', () => {
    const data = emptyEvent();
    data.teams = [{ key: 'frc10', team_number: 10 }];
    data.rankings = rankings([rankRow(1, 'frc11', [1, 0, 0])]);
    data.matches = [match({ num: 1, red: ['frc12', 'frc13', 'frc14'], blue: ['frc15', 'frc16', 'frc17'] })];
    data.alliances = [alliance(['frc18', 'frc19', 'frc20'], { backup: { in: 'frc21', out: 'frc20' } })];
    data.awards = [{ name: 'x', award_type: 29, recipient_list: [{ team_key: 'frc22', awardee: null }] }];
    data.oprs = { oprs: { frc23: 5 } };
    const { teams } = scoreEvent(data, DEFAULT_SCORING);
    for (let n = 10; n <= 23; n++) expect(teams.has(`frc${n}`), `frc${n}`).toBe(true);
  });

  it('never throws on an event with no data, and returns zero teams', () => {
    const out = scoreEvent(emptyEvent(), DEFAULT_SCORING);
    expect(out.teams.size).toBe(0);
    expect(out.qualsComplete).toBe(false);
    expect(out.rpMethod).toBe('none');
  });

  it('gives listed teams a zero score before the event starts', () => {
    const data = emptyEvent();
    data.teams = [{ key: 'frc341B', team_number: 341 }];
    const { teams } = scoreEvent(data, DEFAULT_SCORING);
    expect(teams.get('frc341B')).toEqual({ teamKey: 'frc341B', total: 0, lines: [] });
  });

  it('holds back the OPR bonus and says "Current rank" while quals are running', () => {
    const data = finishedEvent();
    data.alliances = null;
    data.matches = [
      match({ num: 1, red: A0, blue: A1, redScore: 50, blueScore: 10 }),
      match({ num: 2, red: A0, blue: A1 }),
    ];
    const { teams, qualsComplete } = scoreEvent(data, DEFAULT_SCORING);
    expect(qualsComplete).toBe(false);
    const lines = teams.get('frc1')!.lines;
    expect(lines.some((l) => l.category === 'oprBonus')).toBe(false);
    expect(lines.find((l) => l.category === 'rank')!.label).toBe('Current rank #1');
  });

  it('uses the round config, not the defaults', () => {
    const config = { ...DEFAULT_SCORING, qualWin: 1, eventWinner: 100 };
    const { teams } = scoreEvent(finishedEvent(), config);
    const t = teams.get('frc1')!;
    expect(t.lines.find((l) => l.category === 'qualRecord')!.points).toBe(2);
    expect(t.lines.find((l) => l.category === 'eventResult')!.points).toBe(100);
  });
});
