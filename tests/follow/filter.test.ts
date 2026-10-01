import { describe, expect, it } from 'vitest';
import { pickFollowEvents } from '@/lib/follow/filter';
import type { EventSimple } from '@/lib/tba/types';

const ev = (key: string, event_type: number, start: string, end = start): EventSimple => ({
  key, name: key, event_type, start_date: start, end_date: end,
});
const TODAY = '2026-10-10';
const none = { existing: new Set<string>(), skipped: new Set<string>() };

describe('pickFollowEvents (spec §5.4)', () => {
  it('keeps official and offseason events, drops preseason and unlabeled', () => {
    const events = [
      ev('2026paca', 1, '2026-10-20'),
      ev('2026parr', 99, '2026-10-24'),
      ev('2026week0', 100, '2026-10-20'),
      ev('2026mystery', -1, '2026-10-20'),
      ev('2026cmptx', 4, '2026-10-30'),
    ];
    expect(pickFollowEvents(events, { today: TODAY, ...none }).map((e) => e.key)).toEqual([
      '2026paca',
      '2026parr',
      '2026cmptx',
    ]);
  });

  it('keeps an event that ended yesterday, drops one that ended two days ago', () => {
    const events = [ev('2026a', 99, '2026-10-08', '2026-10-09'), ev('2026b', 99, '2026-10-07', '2026-10-08')];
    expect(pickFollowEvents(events, { today: TODAY, ...none }).map((e) => e.key)).toEqual(['2026a']);
  });

  it('skips events already in the league and ones the commissioner deleted (Review Focus 1)', () => {
    const events = [ev('2026a', 99, '2026-10-20'), ev('2026b', 99, '2026-10-21'), ev('2026c', 99, '2026-10-22')];
    const out = pickFollowEvents(events, { today: TODAY, existing: new Set(['2026a']), skipped: new Set(['2026b']) });
    expect(out.map((e) => e.key)).toEqual(['2026c']);
  });

  it('lists an event once when two followed teams both attend, in date order', () => {
    const events = [ev('2026z', 99, '2026-11-01'), ev('2026a', 99, '2026-10-20'), ev('2026z', 99, '2026-11-01')];
    expect(pickFollowEvents(events, { today: TODAY, ...none }).map((e) => e.key)).toEqual(['2026a', '2026z']);
  });

  it('ignores junk rows (bad key or dates)', () => {
    const events = [
      { ...ev('2026a', 99, '2026-10-20'), key: 'not a key' },
      { ...ev('2026b', 99, '2026-10-20'), end_date: '' },
    ] as EventSimple[];
    expect(pickFollowEvents(events, { today: TODAY, ...none })).toEqual([]);
  });
});
