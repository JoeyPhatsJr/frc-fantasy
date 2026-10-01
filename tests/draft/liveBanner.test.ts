import { describe, expect, it } from 'vitest';
import type { RoundRow } from '@/lib/db/types';
import { liveDraftsOf } from '@/lib/draft/liveBanner';

const round = (id: string, over: Partial<RoundRow> = {}) =>
  ({
    id, eventName: `Event ${id}`, draftMode: 'live', draftStartedAt: '2026-10-23T23:00:00Z', draftPausedAt: null,
    rosterSize: 2, draftOrder: ['a', 'b'], ...over,
  }) as RoundRow;

describe('liveDraftsOf (§7.6)', () => {
  it('lists live and paused drafts only', () => {
    const views = [
      { round: round('live'), picks: [1] },
      { round: round('paused', { draftPausedAt: '2026-10-23T23:05:00Z' }), picks: [] },
      { round: round('setup', { draftStartedAt: null }), picks: [] },
      { round: round('done'), picks: [1, 2, 3, 4] },
      { round: round('v1', { draftMode: 'commissioner', draftStartedAt: null }), picks: [1] },
    ];
    expect(liveDraftsOf(views)).toEqual([
      { roundId: 'live', eventName: 'Event live', phase: 'live' },
      { roundId: 'paused', eventName: 'Event paused', phase: 'paused' },
    ]);
  });
});
