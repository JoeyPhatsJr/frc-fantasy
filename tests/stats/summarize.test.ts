import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { scoreEvent } from '@/lib/scoring/engine';
import { allianceMembers } from '@/lib/scoring/playoffs';
import { betterFinish, summarizeEvent } from '@/lib/stats/summarize';
import { cleanEventData } from '@/lib/tba/clean';
import type { EventData, TbaEvent } from '@/lib/tba/types';
import { alliance, emptyEvent, match, rankRow, rankings } from '../helpers/builders';
import { loadFixture, loadFixtureEvent } from '../helpers/fixture';

const parr = cleanEventData(loadFixture('2025parr'));
const parrEvent = loadFixtureEvent('2025parr');
const parrScores = scoreEvent(parr, DEFAULT_SCORING);
const summaries = summarizeEvent(parrEvent, parr, parrScores);
const byTeam = new Map(summaries.map((s) => [s.teamKey, s]));

const synthetic = (key: string, extra: Partial<TbaEvent> = {}): TbaEvent => ({
  key,
  name: `Event ${key}`,
  start_date: '2026-03-14',
  end_date: '2026-03-16',
  timezone: 'America/New_York',
  event_type: 1,
  ...extra,
});

describe('summarizeEvent on Ramp Riot 2025', () => {
  it('covers every team that played a qual match, with the event facts attached', () => {
    expect(summaries.length).toBeGreaterThan(30);
    for (const s of summaries) {
      expect(s.playedQuals, s.teamKey).toBeGreaterThan(0);
      expect(s.eventKey).toBe('2025parr');
      expect(s.endDate).toBe('2025-10-18');
    }
  });

  it('knows the winner, the finalist, captains, and picks (Alliance 2 had 4 robots)', () => {
    expect(byTeam.get('frc2607')?.finish).toBe('winner'); // Alliance 3 captain
    expect(byTeam.get('frc1712')?.finish).toBe('winner');
    expect(byTeam.get('frc316')?.finish).toBe('finalist'); // Alliance 4 captain
    expect(byTeam.get('frc7414')?.finish).toBe('captain'); // Alliance 1, lost in playoffs
    expect(byTeam.get('frc341')?.finish).toBe('picked');
    expect(byTeam.get('frc9991')?.finish).toBe('picked'); // Alliance 2's fourth robot
  });

  it('leaves finish null for a team that was never on an alliance', () => {
    const onAlliance = new Set(parr.alliances!.flatMap(allianceMembers));
    const loner = summaries.find((s) => !onAlliance.has(s.teamKey));
    expect(loner, 'the fixture has unpicked teams').toBeDefined();
    expect(loner!.finish).toBeNull();
  });

  it('copies rank, record, OPR, and default-scoring points', () => {
    const t = byTeam.get('frc2607')!;
    expect(t.rank).toBe(3);
    expect([t.wins, t.losses, t.ties]).toEqual([5, 0, 0]);
    expect(t.opr).toBeCloseTo(89.459, 2);
    expect(t.points).toBe(parrScores.teams.get('frc2607')!.total);
  });
});

// Review Focus 3.
describe('events that must not count', () => {
  it('skips Einstein-style events with playoff matches but no quals', () => {
    const data: EventData = {
      ...emptyEvent(),
      alliances: [alliance(['frc1', 'frc2', 'frc3']), alliance(['frc4', 'frc5', 'frc6'])],
      matches: [
        match({ level: 'f', set: 1, num: 1, red: ['frc1', 'frc2', 'frc3'], blue: ['frc4', 'frc5', 'frc6'], redScore: 90, blueScore: 80 }),
        match({ level: 'f', set: 1, num: 2, red: ['frc1', 'frc2', 'frc3'], blue: ['frc4', 'frc5', 'frc6'], redScore: 90, blueScore: 80 }),
      ],
    };
    const ev = synthetic('2026cmptx', { event_type: 4 });
    expect(summarizeEvent(ev, data, scoreEvent(data, DEFAULT_SCORING))).toEqual([]);
  });

  it('skips teams whose qual matches are scheduled but not played', () => {
    const data: EventData = {
      ...emptyEvent(),
      matches: [match({ num: 1, red: ['frc1', 'frc2', 'frc3'], blue: ['frc4', 'frc5', 'frc6'] })], // no scores
      rankings: rankings([rankRow(1, 'frc1', null)]),
    };
    expect(summarizeEvent(synthetic('2026paca'), data, scoreEvent(data, DEFAULT_SCORING))).toEqual([]);
  });

  it('counts a team only for the qual matches that have a result', () => {
    const data: EventData = {
      ...emptyEvent(),
      matches: [
        match({ num: 1, red: ['frc1', 'frc2', 'frc3'], blue: ['frc4', 'frc5', 'frc6'], redScore: 10, blueScore: 5 }),
        match({ num: 2, red: ['frc1', 'frc2', 'frc3'], blue: ['frc4', 'frc5', 'frc6'] }),
      ],
    };
    const got = summarizeEvent(synthetic('2026paca'), data, scoreEvent(data, DEFAULT_SCORING));
    expect(got.find((s) => s.teamKey === 'frc1')?.playedQuals).toBe(1);
    expect(got.find((s) => s.teamKey === 'frc1')?.wins).toBe(1);
  });
});

describe('awards', () => {
  it('keeps team awards and skips the excluded types (Winner, Finalist, individual awards)', () => {
    const data: EventData = {
      ...emptyEvent(),
      matches: [match({ num: 1, red: ['frc1', 'frc2', 'frc3'], blue: ['frc4', 'frc5', 'frc6'], redScore: 10, blueScore: 5 })],
      awards: [
        { name: 'FIRST Impact Award', award_type: 0, recipient_list: [{ team_key: 'frc1', awardee: null }] },
        { name: 'Winner', award_type: 1, recipient_list: [{ team_key: 'frc1', awardee: null }] },
        { name: "Dean's List Finalist", award_type: 4, recipient_list: [{ team_key: 'frc1', awardee: 'Sam' }] },
      ],
    };
    const got = summarizeEvent(synthetic('2026paca'), data, scoreEvent(data, DEFAULT_SCORING));
    expect(got.find((s) => s.teamKey === 'frc1')?.awards).toEqual([
      { type: 0, name: 'FIRST Impact Award', eventKey: '2026paca' },
    ]);
  });
});

// Final review M4: Championship awards (Impact, Engineering Inspiration...) are listed on cmptx,
// which has no quals. They must reach the team sheet without counting cmptx as an event played.
describe('awards at an event that does not count', () => {
  it('returns an awards-only summary (no quals, no points, no finish) for an Einstein award winner', () => {
    const data: EventData = {
      ...emptyEvent(),
      alliances: [alliance(['frc1', 'frc2', 'frc3']), alliance(['frc4', 'frc5', 'frc6'])],
      matches: [match({ level: 'f', num: 1, red: ['frc1', 'frc2', 'frc3'], blue: ['frc4', 'frc5', 'frc6'], redScore: 9, blueScore: 1 })],
      awards: [
        { name: 'FIRST Impact Award', award_type: 0, recipient_list: [{ team_key: 'frc254', awardee: null }] },
        { name: 'Winner', award_type: 1, recipient_list: [{ team_key: 'frc1', awardee: null }] },
      ],
    };
    const got = summarizeEvent(synthetic('2026cmptx', { event_type: 4 }), data, scoreEvent(data, DEFAULT_SCORING));
    expect(got).toEqual([
      {
        teamKey: 'frc254', eventKey: '2026cmptx', name: 'Event 2026cmptx', endDate: '2026-03-16',
        playedQuals: 0, wins: 0, losses: 0, ties: 0, rank: null, finish: null, points: 0, opr: null,
        awards: [{ type: 0, name: 'FIRST Impact Award', eventKey: '2026cmptx' }],
      },
    ]);
  });
});

describe('betterFinish', () => {
  it('orders winner > finalist > captain > picked > none', () => {
    expect(betterFinish('picked', 'captain')).toBe('captain');
    expect(betterFinish('winner', 'finalist')).toBe('winner');
    expect(betterFinish(null, 'picked')).toBe('picked');
    expect(betterFinish(null, null)).toBeNull();
  });
});
