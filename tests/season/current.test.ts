import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getTba: undefined as unknown as (...args: unknown[]) => unknown }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import type { RoundRow } from '@/lib/db/types';
import { pickEventForMe, seasonCurrentEvent } from '@/lib/season/current';
import type { EventSimple } from '@/lib/tba/types';

const ev = (key: string, event_type: number, start: string, end = start): EventSimple => ({
  key, name: `Event ${key}`, event_type, start_date: start, end_date: end,
});
const EVENTS = [ev('2027paca', 1, '2027-03-05', '2027-03-07'), ev('2027mrcmp', 2, '2027-04-08', '2027-04-11'), ev('2027off', 99, '2027-03-20')];

describe('seasonCurrentEvent', () => {
  it('finds the event whose dates contain today, with a day either side', () => {
    expect(seasonCurrentEvent(EVENTS, '2027-03-04')).toEqual({ kind: 'current', event: EVENTS[0] });
    expect(seasonCurrentEvent(EVENTS, '2027-03-08')).toEqual({ kind: 'current', event: EVENTS[0] });
  });
  it('otherwise gives the next official event within 7 days', () => {
    expect(seasonCurrentEvent(EVENTS, '2027-04-01')).toEqual({ kind: 'next', event: EVENTS[1] });
  });
  it('omits teams with nothing in the next 7 days, and ignores offseason events', () => {
    expect(seasonCurrentEvent(EVENTS, '2027-03-15')).toBeNull(); // 2027off is 5 days away but offseason
    expect(seasonCurrentEvent(EVENTS, '2027-03-31')).toBeNull(); // mrcmp is 8 days away
  });
});

describe('pickEventForMe', () => {
  beforeEach(() => {
    h.getTba = vi.fn(async () => ({ data: EVENTS, fetchedAt: 'x', stale: false }));
  });
  const NOW = new Date('2027-03-06T16:00:00.000Z');

  it('uses a TBA round’s own event and skips manual rounds', async () => {
    expect(await pickEventForMe({ kind: 'tba', eventKey: '2026parr' } as RoundRow, 'frc5181', NOW)).toEqual({ kind: 'event', eventKey: '2026parr' });
    expect(await pickEventForMe({ kind: 'manual', eventKey: null } as RoundRow, 'frc5181', NOW)).toBeNull();
    expect(h.getTba).not.toHaveBeenCalled();
  });

  it('finds a season pick’s current or next event', async () => {
    const round = { kind: 'season', seasonYear: 2027 } as RoundRow;
    expect(await pickEventForMe(round, 'frc5181', NOW)).toEqual({ kind: 'event', eventKey: '2027paca' });
    expect(await pickEventForMe(round, 'frc5181', new Date('2027-04-02T16:00:00.000Z'))).toEqual({
      kind: 'next', name: 'Event 2027mrcmp', startDate: '2027-04-08',
    });
    expect(h.getTba).toHaveBeenCalledWith('/team/frc5181/events/2027/simple', expect.anything());
  });
});
