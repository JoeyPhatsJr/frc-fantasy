import { describe, expect, it } from 'vitest';
import { OTHER_AWARD_TYPE, awardName } from '@/lib/scoring/awardTypes';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { scoreManualEvent } from '@/lib/scoring/manual';
import type { ManualResult } from '@/lib/scoring/types';

const blank = (teamKey: string, over: Partial<ManualResult> = {}): ManualResult => ({
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

describe('scoreManualEvent', () => {
  it('emits the same categories, labels and points as scoreEvent for a full result', () => {
    const out = scoreManualEvent(
      [
        blank('frc5181', {
          qualWins: 7, qualLosses: 2, qualTies: 1, rankingPoints: 24, qualRank: 3,
          allianceRole: 'captain', playoffWins: 5, eventResult: 'winner', awardTypes: [0],
        }),
      ],
      DEFAULT_SCORING,
    );
    expect(out.teams.get('frc5181')!.lines).toEqual([
      { category: 'qualRecord', label: 'Qual record 7-2-1', points: 7 * 3 + 1 * 1 },
      { category: 'rankingPoints', label: 'Ranking points 24', quantity: 24, points: 24 },
      { category: 'rank', label: 'Final rank #3', quantity: 3, points: 5 },
      { category: 'alliance', label: 'Alliance captain', points: 8 },
      { category: 'playoffWins', label: 'Playoff wins ×5', quantity: 5, points: 20 },
      { category: 'eventResult', label: 'Event winner', points: 15 },
      { category: 'awards', label: 'Impact Award', points: 10 },
    ]);
    expect(out.teams.get('frc5181')!.total).toBe(22 + 24 + 5 + 8 + 20 + 15 + 10);
  });

  it('emits no line for unknown RP or rank, no alliance, no playoff wins, no result', () => {
    const lines = scoreManualEvent([blank('frc341', { qualWins: 1 })], DEFAULT_SCORING).teams.get('frc341')!.lines;
    expect(lines.map((l) => l.category)).toEqual(['qualRecord']);
  });

  it('labels every alliance role the way scoreEvent does', () => {
    const roles = ['captain', 'pick1', 'pick2', 'pick3', 'backup'] as const;
    const out = scoreManualEvent(
      roles.map((allianceRole, i) => blank(`frc${i + 1}`, { allianceRole })),
      DEFAULT_SCORING,
    );
    expect(roles.map((_, i) => out.teams.get(`frc${i + 1}`)!.lines[1])).toEqual([
      { category: 'alliance', label: 'Alliance captain', points: 8 },
      { category: 'alliance', label: 'Alliance first pick', points: 6 },
      { category: 'alliance', label: 'Alliance second pick', points: 3 },
      { category: 'alliance', label: 'Alliance third pick', points: 2 },
      { category: 'alliance', label: 'Backup robot', points: 2 },
    ]);
  });

  it('scores finalists', () => {
    const lines = scoreManualEvent([blank('frc1', { eventResult: 'finalist' })], DEFAULT_SCORING).teams.get('frc1')!.lines;
    expect(lines).toContainEqual({ category: 'eventResult', label: 'Event finalist', points: 8 });
  });

  it('applies the config award rules: excluded types score nothing, unknown types use the default', () => {
    // 1 = Winner (excluded in the default config), 70 = Other (not in byType → default 5)
    const lines = scoreManualEvent([blank('frc1', { awardTypes: [1, OTHER_AWARD_TYPE] })], DEFAULT_SCORING).teams.get(
      'frc1',
    )!.lines;
    expect(lines.filter((l) => l.category === 'awards')).toEqual([
      { category: 'awards', label: 'Other award', points: 5 },
    ]);
  });

  it('never emits an OPR bonus', () => {
    const out = scoreManualEvent([blank('frc1', { qualRank: 1, qualWins: 10 })], DEFAULT_SCORING);
    expect(out.teams.get('frc1')!.lines.some((l) => l.category === 'oprBonus')).toBe(false);
  });

  it('reports rpMethod manual and qualsComplete only once there are results', () => {
    expect(scoreManualEvent([], DEFAULT_SCORING)).toEqual({ teams: new Map(), qualsComplete: false, rpMethod: 'manual' });
    expect(scoreManualEvent([blank('frc1')], DEFAULT_SCORING).qualsComplete).toBe(true);
  });
});

describe('awardName', () => {
  it('names known types and falls back for unknown ones', () => {
    expect(awardName(0)).toBe('Impact Award');
    expect(awardName(9999)).toBe('Award (type 9999)');
  });
});
