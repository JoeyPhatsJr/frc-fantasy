import { describe, expect, it } from 'vitest';
import {
  addDays,
  cacheWindowFor,
  eventPhase,
  localDate,
  roundStatus,
  shouldNudgeFinalize,
  STATUS_LABEL,
} from '@/lib/rounds/status';

// Ramp Riot 2026 is one day: Sat Oct 24, 2026. Eastern is UTC-4 (EDT) on these dates.
const timing = {
  startDate: '2026-10-24',
  endDate: '2026-10-24',
  timezone: 'America/New_York',
  finalizedAt: null,
};
const drafted = { ...timing, rosterSize: 2, draftOrder: ['a', 'b'] }; // 4 picks completes the draft

const MIN = 60_000;

describe('localDate', () => {
  it('uses the round timezone, not UTC', () => {
    expect(localDate(new Date('2026-10-26T03:30:00Z'), 'America/New_York')).toBe('2026-10-25');
    expect(localDate(new Date('2026-10-26T04:30:00Z'), 'America/New_York')).toBe('2026-10-26');
  });
  // Review Focus 4
  it('falls back to Eastern for a missing or unknown timezone', () => {
    const now = new Date('2026-10-26T03:30:00Z');
    expect(localDate(now, null)).toBe('2026-10-25');
    expect(localDate(now, '')).toBe('2026-10-25');
    expect(localDate(now, 'Mars/Olympus_Mons')).toBe('2026-10-25');
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-10-24', 0)).toBe('2026-10-24');
  });
});

describe('eventPhase', () => {
  it('is "before" until the day before the event', () => {
    expect(eventPhase(timing, new Date('2026-10-23T03:30:00Z'))).toBe('before'); // Oct 22, 11:30 pm ET
  });
  it('is "during" from start - 1 day through end + 1 day', () => {
    expect(eventPhase(timing, new Date('2026-10-23T04:30:00Z'))).toBe('during'); // Oct 23, 12:30 am ET
    expect(eventPhase(timing, new Date('2026-10-24T18:00:00Z'))).toBe('during');
    expect(eventPhase(timing, new Date('2026-10-26T03:30:00Z'))).toBe('during'); // Oct 25, 11:30 pm ET
  });
  it('is "after" once end + 1 day has passed locally', () => {
    expect(eventPhase(timing, new Date('2026-10-26T04:30:00Z'))).toBe('after'); // Oct 26, 12:30 am ET
  });
});

describe('cacheWindowFor (§7.3)', () => {
  it('is 60 s during the event window', () => {
    expect(cacheWindowFor(timing, new Date('2026-10-24T18:00:00Z'))).toBe(1 * MIN);
  });
  it('is 10 min before and after', () => {
    expect(cacheWindowFor(timing, new Date('2026-10-01T12:00:00Z'))).toBe(10 * MIN);
    expect(cacheWindowFor(timing, new Date('2026-11-05T12:00:00Z'))).toBe(10 * MIN);
  });
  it('is 24 h once finalized, even on event day', () => {
    const final = { ...timing, finalizedAt: '2026-10-24T22:00:00Z' };
    expect(cacheWindowFor(final, new Date('2026-10-24T23:00:00Z'))).toBe(24 * 60 * MIN);
  });
  it('does not throw on a bad timezone', () => {
    expect(cacheWindowFor({ ...timing, timezone: 'Nope/Nope' }, new Date('2026-10-24T18:00:00Z'))).toBe(1 * MIN);
  });
});

describe('roundStatus (§7.8)', () => {
  const eventDay = new Date('2026-10-24T18:00:00Z');

  it('is Drafting once a live draft has started, even before the first pick (v2 §7.1)', () => {
    expect(roundStatus({ ...drafted, draftStartedAt: '2026-10-23T23:00:00Z' }, 0, eventDay)).toBe('drafting');
    expect(roundStatus({ ...drafted, draftStartedAt: null }, 0, eventDay)).toBe('setup');
  });
  it('is Final whenever finalized_at is set, regardless of picks or dates', () => {
    const final = { ...drafted, finalizedAt: '2026-10-25T01:00:00Z' };
    expect(roundStatus(final, 0, eventDay)).toBe('final');
    expect(roundStatus(final, 4, eventDay)).toBe('final');
  });
  it('is Setup with no picks', () => {
    expect(roundStatus(drafted, 0, eventDay)).toBe('setup');
    expect(roundStatus({ ...drafted, draftOrder: [] }, 0, eventDay)).toBe('setup');
  });
  it('is Drafting with some but not all picks', () => {
    expect(roundStatus(drafted, 1, eventDay)).toBe('drafting');
    expect(roundStatus(drafted, 3, eventDay)).toBe('drafting');
  });
  it('is Upcoming, Live, then Awaiting final once the draft is complete', () => {
    expect(roundStatus(drafted, 4, new Date('2026-10-20T12:00:00Z'))).toBe('upcoming');
    expect(roundStatus(drafted, 4, new Date('2026-10-23T12:00:00Z'))).toBe('live');
    expect(roundStatus(drafted, 4, eventDay)).toBe('live');
    expect(roundStatus(drafted, 4, new Date('2026-10-26T03:30:00Z'))).toBe('live');
    expect(roundStatus(drafted, 4, new Date('2026-10-26T04:30:00Z'))).toBe('awaiting_final');
  });
  it('never becomes Final from dates alone', () => {
    expect(roundStatus(drafted, 4, new Date('2027-06-01T12:00:00Z'))).toBe('awaiting_final');
  });
});

describe('shouldNudgeFinalize (§5.5)', () => {
  it('nudges only after the event window, and only if not final', () => {
    expect(shouldNudgeFinalize(timing, new Date('2026-10-24T18:00:00Z'))).toBe(false);
    expect(shouldNudgeFinalize(timing, new Date('2026-10-26T04:30:00Z'))).toBe(true);
    expect(shouldNudgeFinalize({ ...timing, finalizedAt: '2026-10-26T00:00:00Z' }, new Date('2026-10-27T12:00:00Z'))).toBe(false);
  });
});

describe('STATUS_LABEL', () => {
  it('has the spec badge text', () => {
    expect(STATUS_LABEL).toEqual({
      setup: 'Setup',
      drafting: 'Drafting',
      upcoming: 'Upcoming',
      live: 'Live',
      awaiting_final: 'Awaiting final',
      final: 'Final',
    });
  });
});
