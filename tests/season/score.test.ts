import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
  getEventScores: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));
vi.mock('@/lib/scores/eventScores', () => ({ getEventScores: (...args: unknown[]) => h.getEventScores(...args) }));

import type { RoundRow } from '@/lib/db/types';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import type { EventScores, Line } from '@/lib/scoring/types';
import { createFetchBudget } from '@/lib/season/budget';
import { scoreSeasonRound } from '@/lib/season/score';

const NOW = new Date('2027-03-14T16:00:00.000Z'); // a Sunday of week 2
const round = {
  id: 'r1', kind: 'season', seasonYear: 2027, scoring: DEFAULT_SCORING, finalizedAt: null,
} as unknown as RoundRow;

const ev = (key: string, event_type: number, start: string, end: string) => ({ key, name: `Event ${key}`, event_type, start_date: start, end_date: end });
const TEAM_EVENTS: Record<string, unknown[]> = {
  frc5181: [
    ev('2027paca', 1, '2027-03-05', '2027-03-07'), // week 1, done
    ev('2027pahat', 1, '2027-03-13', '2027-03-15'), // in progress
    ev('2027mrcmp', 2, '2027-04-08', '2027-04-11'), // future
    ev('2027parr', 99, '2027-10-23', '2027-10-23'), // offseason: never counts
  ],
  frc341: [ev('2027pahat', 1, '2027-03-13', '2027-03-15')],
  frc9999: [],
};
const line = (points: number): Line => ({ category: 'qualRecord', label: `Qual record +${points}`, points });
const scoresFor = (byTeam: Record<string, number>): EventScores => ({
  teams: new Map(Object.entries(byTeam).map(([k, p]) => [k, { teamKey: k, total: p, lines: [line(p)] }])),
  qualsComplete: true,
  rpMethod: 'extra_stats',
});
const EVENT_SCORES: Record<string, EventScores> = {
  '2027paca': scoresFor({ frc5181: 41 }),
  '2027pahat': scoresFor({ frc5181: 12, frc341: 30 }),
};

beforeEach(() => {
  h.getTba = vi.fn(async (path: unknown) => {
    const m = /^\/team\/(frc\d+)\/events\/2027\/simple$/.exec(String(path));
    return { data: m ? TEAM_EVENTS[m[1]] ?? [] : null, fetchedAt: '2027-03-14T15:59:00.000Z', stale: false };
  });
  h.getEventScores = vi.fn(async (eventKey: unknown) => ({
    scores: EVENT_SCORES[String(eventKey)] ?? scoresFor({}),
    stale: false,
    fetchedAt: '2027-03-14T15:58:00.000Z',
  }));
});

describe('scoreSeasonRound', () => {
  it('sums a team over its official events that have started, grouped per event', async () => {
    const out = await scoreSeasonRound(round, ['frc5181'], NOW);
    expect(out.teams.get('frc5181')!.total).toBe(53);
    expect(out.detail.frc5181.events.map((e) => [e.eventKey, e.total])).toEqual([
      ['2027paca', 41],
      ['2027pahat', 12],
    ]);
    expect(out.detail.frc5181.next).toEqual({ eventKey: '2027mrcmp', name: 'Event 2027mrcmp', startDate: '2027-04-08' });
    expect(out.teams.get('frc5181')!.lines).toEqual([line(41), line(12)]);
  });

  it('never scores offseason or future events', async () => {
    await scoreSeasonRound(round, ['frc5181'], NOW);
    const scored = vi.mocked(h.getEventScores).mock.calls.map((c) => c[0]);
    expect(scored.sort()).toEqual(['2027paca', '2027pahat']);
  });

  it('scores an event shared by two drafted teams once, with the round scoring', async () => {
    const out = await scoreSeasonRound(round, ['frc5181', 'frc341'], NOW);
    expect(vi.mocked(h.getEventScores).mock.calls.filter((c) => c[0] === '2027pahat')).toHaveLength(1);
    expect(vi.mocked(h.getEventScores).mock.calls[0][1]).toBe(DEFAULT_SCORING);
    expect(out.teams.get('frc341')!.total).toBe(30);
  });

  it("uses each event's own cache window", async () => {
    await scoreSeasonRound(round, ['frc5181'], NOW);
    const windows = Object.fromEntries(vi.mocked(h.getEventScores).mock.calls.map((c) => [c[0], c[2]]));
    expect(windows['2027pahat']).toBe(60_000); // during the event
    expect(windows['2027paca']).toBe(10 * 60_000); // finished, round not final
    await scoreSeasonRound({ ...round, finalizedAt: '2027-05-01T00:00:00.000Z' } as RoundRow, ['frc5181'], NOW);
    expect(vi.mocked(h.getEventScores).mock.calls.at(-1)![2]).toBe(24 * 60 * 60_000);
  });

  it('gives a team with no events 0, no rows and no next event', async () => {
    const out = await scoreSeasonRound(round, ['frc9999'], NOW);
    expect(out.teams.get('frc9999')).toEqual({ teamKey: 'frc9999', total: 0, lines: [] });
    expect(out.detail.frc9999).toEqual({ teamKey: 'frc9999', total: 0, events: [], next: null });
  });

  it('once the budget is spent, reads caches only (infinite window) and marks the page stale (Review Focus 4)', async () => {
    let t = 0;
    const spent = createFetchBudget({ maxInFlight: 4, budgetMs: 0, clock: () => t++ });
    const out = await scoreSeasonRound(round, ['frc5181'], NOW, spent);
    expect(out.stale).toBe(true);
    expect(out.teams.get('frc5181')!.total).toBe(53); // cached data still scores
    for (const c of vi.mocked(h.getEventScores).mock.calls) expect(c[2]).toBe(Number.POSITIVE_INFINITY);
    for (const c of vi.mocked(h.getTba).mock.calls) expect(c[1]).toEqual({ windowMs: Number.POSITIVE_INFINITY });
  });

  it('survives getEventScores throwing: that event counts 0 and the page is stale', async () => {
    h.getEventScores = vi.fn(async () => {
      throw new Error('boom');
    });
    const out = await scoreSeasonRound(round, ['frc5181'], NOW);
    expect(out.teams.get('frc5181')!.total).toBe(0);
    expect(out.stale).toBe(true);
  });

  it('reports the oldest fetch time', async () => {
    const out = await scoreSeasonRound(round, ['frc5181'], NOW);
    expect(out.fetchedAt).toBe('2027-03-14T15:58:00.000Z');
  });
});
