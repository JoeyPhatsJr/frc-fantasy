import { describe, expect, it } from 'vitest';
import {
  chooseAutoPick,
  clockOffset,
  draftPhase,
  nextDeadline,
  onClockPlayer,
  pausedRemainingMs,
  picksUntilTurn,
  parseTimestamp,
  remainingMs,
  resumeDeadline,
  resumeRemainingMs,
  totalPicks,
} from '@/lib/draft/live';

const base = {
  draftMode: 'live' as const,
  draftStartedAt: null as string | null,
  draftPausedAt: null as string | null,
  rosterSize: 2,
  draftOrder: ['joey', 'mom', 'dad'],
};
const T0 = Date.parse('2026-10-23T23:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('draftPhase (§7.1)', () => {
  it('is setup before start, live once started, paused while paused, done when full', () => {
    expect(draftPhase(base, 0)).toBe('setup');
    const started = { ...base, draftStartedAt: iso(T0) };
    expect(draftPhase(started, 0)).toBe('live');
    expect(draftPhase({ ...started, draftPausedAt: iso(T0 + 1000) }, 3)).toBe('paused');
    expect(draftPhase(started, 6)).toBe('done');
  });
  it('treats commissioner-mode rounds as setup until full (v1 behaves as before)', () => {
    const v1 = { ...base, draftMode: 'commissioner' as const };
    expect(draftPhase(v1, 3)).toBe('setup');
    expect(draftPhase(v1, 6)).toBe('done');
  });
  it('an empty draft order is never done', () => {
    expect(draftPhase({ ...base, draftOrder: [] }, 0)).toBe('setup');
  });
});

describe('whose turn', () => {
  it('follows the snake: joey mom dad dad mom joey', () => {
    expect(totalPicks(base)).toBe(6);
    expect([0, 1, 2, 3, 4, 5].map((n) => onClockPlayer(base, n))).toEqual(['joey', 'mom', 'dad', 'dad', 'mom', 'joey']);
    expect(onClockPlayer(base, 6)).toBeNull();
    expect(onClockPlayer({ ...base, draftOrder: [] }, 0)).toBeNull();
  });
  it('counts picks until my turn (0 = on the clock, null = no turns left)', () => {
    expect(picksUntilTurn(base, 0, 'joey')).toBe(0);
    expect(picksUntilTurn(base, 0, 'dad')).toBe(2);
    expect(picksUntilTurn(base, 1, 'joey')).toBe(4);
    expect(picksUntilTurn(base, 6, 'joey')).toBeNull();
    expect(picksUntilTurn(base, 0, 'stranger')).toBeNull();
  });
});

describe('deadlines (§7.1, §7.2)', () => {
  it('sets the next deadline only while a timer is on and picks remain', () => {
    expect(nextDeadline(60, 1, 6, T0)).toBe(iso(T0 + 60_000));
    expect(nextDeadline(null, 1, 6, T0)).toBeNull();
    expect(nextDeadline(60, 6, 6, T0)).toBeNull();
  });
  it('pausing keeps the time left, never negative', () => {
    expect(pausedRemainingMs(iso(T0 + 42_000), T0)).toBe(42_000);
    expect(pausedRemainingMs(iso(T0 - 5_000), T0)).toBe(0);
    expect(pausedRemainingMs(null, T0)).toBeNull();
  });
  it('resuming gives at least 10 s, or the full timer when the remaining time was cleared', () => {
    expect(resumeDeadline(60, 42_000, T0)).toBe(iso(T0 + 42_000));
    expect(resumeDeadline(60, 0, T0)).toBe(iso(T0 + 10_000)); // Review Focus 3
    expect(resumeDeadline(60, 3_000, T0)).toBe(iso(T0 + 10_000));
    expect(resumeDeadline(90, null, T0)).toBe(iso(T0 + 90_000));
    expect(resumeDeadline(null, 42_000, T0)).toBeNull();
  });
  it('the time a paused player gets on resume, for the paused banner (review M2)', () => {
    expect(resumeRemainingMs(60, 42_000)).toBe(42_000);
    expect(resumeRemainingMs(60, 3_000)).toBe(10_000);
    expect(resumeRemainingMs(60, 0)).toBe(10_000);
    expect(resumeRemainingMs(90, null)).toBe(90_000);
    expect(resumeRemainingMs(null, 42_000)).toBeNull();
  });
});

describe('chooseAutoPick (§7.4)', () => {
  const avail = (...rows: [string, number | null][]) => rows.map(([teamKey, proj]) => ({ teamKey, proj }));
  it('takes the first queued team that is still available', () => {
    expect(chooseAutoPick(['frc254', 'frc341'], avail(['frc341', 10], ['frc1', 50]))).toBe('frc341');
  });
  it('falls back to the highest projection', () => {
    expect(chooseAutoPick([], avail(['frc1', 12], ['frc2', 30.5], ['frc3', 30.5]))).toBe('frc2');
  });
  it('puts New teams after projected ones, then lowest team number (B-teams after their A-team)', () => {
    expect(chooseAutoPick([], avail(['frc9', null], ['frc100', 1]))).toBe('frc100');
    expect(chooseAutoPick([], avail(['frc1000', null], ['frc341B', null], ['frc341', null]))).toBe('frc341');
  });
  it('returns null when nothing is available', () => {
    expect(chooseAutoPick(['frc1'], [])).toBeNull();
  });
});

describe('clock sync (§7.5)', () => {
  it('estimates the server-minus-local offset from the round trip', () => {
    // Sent at local 1000, received at local 1200 (rtt 200); server said T0 at the midpoint (local 1100).
    expect(clockOffset(iso(T0), 1000, 1200)).toBe(T0 - 1100);
  });
  it('a phone clock that is 3 minutes fast still counts down the server deadline', () => {
    const fast = 180_000;
    const offset = clockOffset(iso(T0), T0 + fast - 100, T0 + fast + 100);
    expect(remainingMs(iso(T0 + 30_000), offset, T0 + fast)).toBe(30_000);
    expect(remainingMs(iso(T0 - 1), offset, T0 + fast)).toBe(0);
    expect(remainingMs(null, offset, T0)).toBeNull();
  });
});

// Postgres sends timestamptz as microseconds with a +00:00 offset; the memory repo sends ms + Z (review M14).
describe('Postgres timestamps (microseconds, +00:00)', () => {
  const pg = '2026-10-23T23:15:42.123456+00:00';
  const ms = Date.UTC(2026, 9, 23, 23, 15, 42, 123);

  it('parses to the millisecond, dropping the extra digits', () => {
    expect(parseTimestamp(pg)).toBe(ms);
    expect(parseTimestamp('2026-10-23T23:15:42+00:00')).toBe(Date.UTC(2026, 9, 23, 23, 15, 42));
    expect(parseTimestamp('2026-10-23T19:15:42.5-04:00')).toBe(ms - 123 + 500);
    expect(parseTimestamp('2026-10-23T23:15:42.123Z')).toBe(ms);
  });

  it('drives the countdown, pause, and clock offset', () => {
    expect(remainingMs(pg, 0, ms - 30_000)).toBe(30_000);
    expect(remainingMs(pg, 1_000, ms - 30_000)).toBe(29_000);
    expect(pausedRemainingMs(pg, ms - 4_000)).toBe(4_000);
    // Request sent at 0, answered at 200: the server read its clock at local 100.
    expect(clockOffset(pg, 0, 200)).toBe(ms - 100);
  });
});
