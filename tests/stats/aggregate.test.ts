import { describe, expect, it } from 'vitest';
import { aggregateTeamSeason, type TeamEventSummary } from '@/lib/stats/summarize';

const s = (eventKey: string, endDate: string, extra: Partial<TeamEventSummary> = {}): TeamEventSummary => ({
  teamKey: 'frc5181',
  eventKey,
  name: `Event ${eventKey}`,
  endDate,
  playedQuals: 10,
  wins: 6,
  losses: 4,
  ties: 0,
  rank: 8,
  finish: 'picked',
  points: 30,
  opr: 25.04,
  awards: [],
  ...extra,
});

const T = '2026-10-24T12:00:00.000Z';

describe('aggregateTeamSeason', () => {
  it('sums points and records, and lists events oldest first', () => {
    const row = aggregateTeamSeason('frc5181', 2026, [
      s('2026pahat', '2026-03-22', { points: 50, wins: 8, losses: 2, finish: 'finalist' }),
      s('2026paca', '2026-03-08'),
    ], T);
    expect(row).toMatchObject({
      teamKey: 'frc5181',
      season: 2026,
      eventsPlayed: 2,
      totalPoints: 80,
      qualWins: 14,
      qualLosses: 6,
      qualTies: 0,
      bestFinish: 'finalist',
      updatedAt: T,
    });
    expect(row.events.map((e) => e.eventKey)).toEqual(['2026paca', '2026pahat']);
    expect(row.events[1]).toEqual({ eventKey: '2026pahat', name: 'Event 2026pahat', endDate: '2026-03-22', rank: 8, finish: 'finalist', points: 50 });
  });

  it('takes OPR and rank from the latest event that has them, rounded to one decimal', () => {
    const row = aggregateTeamSeason('frc5181', 2026, [
      s('2026paca', '2026-03-08', { opr: 31.26, rank: 4 }),
      s('2026mrcmp', '2026-04-05', { opr: null, rank: null }), // no data posted
    ], T);
    expect(row.latestEventKey).toBe('2026paca');
    expect(row.latestOpr).toBe(31.3);
    expect(row.latestRank).toBe(4);
  });

  it('collects awards across events', () => {
    const row = aggregateTeamSeason('frc5181', 2026, [
      s('2026paca', '2026-03-08', { awards: [{ type: 0, name: 'Impact', eventKey: '2026paca' }] }),
      s('2026pahat', '2026-03-22', { awards: [{ type: 9, name: 'Engineering Inspiration', eventKey: '2026pahat' }] }),
    ], T);
    expect(row.awards.map((a) => a.type)).toEqual([0, 9]);
  });

  it('ignores other teams and duplicate events', () => {
    const row = aggregateTeamSeason('frc5181', 2026, [
      s('2026paca', '2026-03-08'),
      s('2026paca', '2026-03-08'),
      s('2026paca', '2026-03-08', { teamKey: 'frc341', points: 999 }),
    ], T);
    expect(row.eventsPlayed).toBe(1);
    expect(row.totalPoints).toBe(30);
  });

  it('has nulls, not zeros, when nothing is known', () => {
    const row = aggregateTeamSeason('frc5181', 2026, [s('2026paca', '2026-03-08', { opr: null, rank: null, finish: null })], T);
    expect(row.bestFinish).toBeNull();
    expect(row.latestEventKey).toBeNull();
    expect(row.latestOpr).toBeNull();
    expect(row.latestRank).toBeNull();
  });
});
