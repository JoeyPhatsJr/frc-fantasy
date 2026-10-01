import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getTba: undefined as unknown as (...args: unknown[]) => unknown }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import {
  allowedSeasonYears,
  defaultSeasonYear,
  isOfficialEvent,
  seasonDates,
  seasonRoundName,
} from '@/lib/season/calendar';
import { fetchSeasonDates } from '@/lib/season/fetchDates';
import type { EventSimple } from '@/lib/tba/types';

const ev = (key: string, event_type: number, start: string, end = start): EventSimple => ({
  key, name: key, event_type, start_date: start, end_date: end,
});

describe('official events (spec §5.5)', () => {
  it('counts regionals, districts, district champs (and divisions), champs divisions and finals', () => {
    for (const t of [0, 1, 2, 3, 4, 5]) expect(isOfficialEvent({ event_type: t }), String(t)).toBe(true);
  });
  it('never counts offseason, preseason or unlabeled events', () => {
    for (const t of [99, 100, -1, 6, 7]) expect(isOfficialEvent({ event_type: t }), String(t)).toBe(false);
  });
});

describe('defaultSeasonYear', () => {
  it('is this year until the end of September (Eastern), next year from October on', () => {
    expect(defaultSeasonYear(new Date('2026-09-30T12:00:00Z'))).toBe(2026);
    expect(defaultSeasonYear(new Date('2026-10-01T12:00:00Z'))).toBe(2027);
    // 2026-10-01 02:00 UTC is still Sept 30 in New York
    expect(defaultSeasonYear(new Date('2026-10-01T02:00:00Z'))).toBe(2026);
  });
  it('allows this calendar year and next', () => {
    expect(allowedSeasonYears(new Date('2026-10-23T12:00:00Z'))).toEqual([2026, 2027]);
  });
});

describe('seasonDates', () => {
  it('spans the earliest official start to the latest official end', () => {
    const events = [
      ev('2027week0', 100, '2027-02-13'),
      ev('2027paca', 1, '2027-03-05', '2027-03-07'),
      ev('2027cmptx', 4, '2027-04-17', '2027-04-19'),
      ev('2027parr', 99, '2027-10-23'),
    ];
    expect(seasonDates(events, 2027)).toEqual({ startDate: '2027-03-05', endDate: '2027-04-19' });
  });
  it('is the whole year before TBA publishes the calendar', () => {
    expect(seasonDates(null, 2027)).toEqual({ startDate: '2027-01-01', endDate: '2027-12-31' });
    expect(seasonDates([ev('2027parr', 99, '2027-10-23')], 2027)).toEqual({ startDate: '2027-01-01', endDate: '2027-12-31' });
  });
  it('names the round', () => {
    expect(seasonRoundName(2027)).toBe('2027 Season');
  });
});

describe('fetchSeasonDates', () => {
  beforeEach(() => {
    h.getTba = vi.fn(async () => ({ data: [ev('2027paca', 1, '2027-03-05', '2027-03-07')], fetchedAt: 'x', stale: false }));
  });
  it('reads /events/{year}/simple', async () => {
    expect(await fetchSeasonDates(2027)).toEqual({ startDate: '2027-03-05', endDate: '2027-03-07', stale: false });
    expect(h.getTba).toHaveBeenCalledWith('/events/2027/simple', expect.objectContaining({ windowMs: expect.any(Number) }));
  });
});
