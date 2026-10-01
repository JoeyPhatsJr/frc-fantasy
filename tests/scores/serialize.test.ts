import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { scoreEvent } from '@/lib/scoring/engine';
import { deserializeEventScores, parseEventInfo, serializeEventScores } from '@/lib/scores/serialize';
import { cleanEventData, eventInfo } from '@/lib/tba/clean';
import { loadFixture } from '../helpers/fixture';
import { emptyEvent, match, rankRow, rankings } from '../helpers/builders';

const scored = scoreEvent(cleanEventData(loadFixture('2025parr')), DEFAULT_SCORING);

describe('serializeEventScores / deserializeEventScores', () => {
  it('round-trips the 2025parr scores through JSON (what jsonb stores)', () => {
    const stored = JSON.parse(JSON.stringify(serializeEventScores(scored)));
    const back = deserializeEventScores(stored);
    expect(back).not.toBeNull();
    expect(back!.teams.size).toBe(scored.teams.size);
    expect(back).toEqual(scored);
  });

  it('writes teams as a plain object keyed by team key', () => {
    const s = serializeEventScores(scored);
    expect(s.teams.frc2607.teamKey).toBe('frc2607');
    expect(s.rpMethod).toBe('extra_stats');
  });

  it.each([
    ['null', null],
    ['a number', 5],
    ['teams as an array', { teams: [], qualsComplete: true, rpMethod: 'none' }],
    ['an unknown rpMethod', { teams: {}, qualsComplete: true, rpMethod: 'guess' }],
    ['an unknown line category', { teams: { frc1: { teamKey: 'frc1', total: 1, lines: [{ category: 'bribe', label: 'x', points: 1 }] } }, qualsComplete: true, rpMethod: 'none' }],
    ['a non-number total', { teams: { frc1: { teamKey: 'frc1', total: '1', lines: [] } }, qualsComplete: true, rpMethod: 'none' }],
  ])('rejects %s', (_label, raw) => {
    expect(deserializeEventScores(raw)).toBeNull();
  });
});

describe('eventInfo / parseEventInfo', () => {
  it('collects nicknames and whether TBA has matches and rankings yet', () => {
    const data = {
      ...emptyEvent(),
      teams: [
        { key: 'frc1', team_number: 1, nickname: 'One' },
        { key: 'frc2', team_number: 2, nickname: null },
      ],
      rankings: rankings([rankRow(1, 'frc1', [1, 0, 0])]),
      matches: [match({ num: 1, red: ['frc1'], blue: ['frc2'], redScore: 5, blueScore: 1 })],
    };
    expect(eventInfo(data)).toEqual({ teamNames: { frc1: 'One' }, hasEventData: true, hasRankings: true });
    expect(eventInfo(emptyEvent())).toEqual({ teamNames: {}, hasEventData: false, hasRankings: false });
  });

  it('parses a stored info object and rejects junk', () => {
    const info = { teamNames: { frc1: 'One' }, hasEventData: true, hasRankings: false };
    expect(parseEventInfo(JSON.parse(JSON.stringify(info)))).toEqual(info);
    expect(parseEventInfo({})).toBeNull();
    expect(parseEventInfo(null)).toBeNull();
  });
});
