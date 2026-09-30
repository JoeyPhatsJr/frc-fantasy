import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getTba: vi.fn() }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...a: unknown[]) => h.getTba(...a) }));

import { loadUpcomingEvents, pickUpcoming } from '@/lib/views/landing';

const ev = (key: string, start: string, name = key) => ({ key, name, start_date: start, end_date: start });

describe('pickUpcoming (spec §4.6 Coming up)', () => {
  it('keeps events starting today or later, soonest first, at most 4', () => {
    const events = [ev('a', '2026-10-20'), ev('b', '2026-10-24'), ev('c', '2026-10-31'), ev('d', '2026-11-07'), ev('e', '2026-11-14'), ev('f', '2026-10-24', 'Aardvark')];
    expect(pickUpcoming(events, '2026-10-24').map((e) => e.key)).toEqual(['f', 'b', 'c', 'd']);
  });
  it('ignores rows without a usable start date', () => {
    expect(pickUpcoming([{ key: 'x', name: 'x', start_date: '', end_date: '' }], '2026-01-01')).toEqual([]);
  });
});

describe('loadUpcomingEvents', () => {
  it('returns [] when TBA is unreachable', async () => {
    h.getTba.mockResolvedValue({ data: null, fetchedAt: null, stale: true });
    expect(await loadUpcomingEvents(new Date('2026-10-01T12:00:00Z'))).toEqual([]);
  });
  it('tops up from next year late in the year', async () => {
    h.getTba.mockImplementation(async (path: string) => ({
      data: path.includes('/2026/') ? [ev('2026x', '2026-12-05')] : [ev('2027a', '2027-02-27'), ev('2027b', '2027-03-06'), ev('2027c', '2027-03-06'), ev('2027d', '2027-03-13')],
      fetchedAt: 'x', stale: false,
    }));
    const out = await loadUpcomingEvents(new Date('2026-11-20T12:00:00Z'));
    expect(out.map((e) => e.key)).toEqual(['2026x', '2027a', '2027b', '2027c']);
  });
  it('never throws', async () => {
    h.getTba.mockRejectedValue(new Error('boom'));
    expect(await loadUpcomingEvents(new Date())).toEqual([]);
  });
});
