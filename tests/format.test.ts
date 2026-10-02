import { describe, expect, it } from 'vitest';
import {
  agoLabel,
  formatDateRange,
  ordinal,
  shortDate,
  freshnessText,
  lineText,
  roundKeyLine,
  signed,
  tbaEventUrl,
  teamName,
} from '@/lib/format';

const NOW = new Date('2026-10-24T18:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

describe('agoLabel', () => {
  it('describes how long ago something happened', () => {
    expect(agoLabel(ago(5 * SEC), NOW)).toBe('just now');
    expect(agoLabel(ago(59 * SEC), NOW)).toBe('just now');
    expect(agoLabel(ago(60 * SEC), NOW)).toBe('1 min ago');
    expect(agoLabel(ago(14 * MIN + 30 * SEC), NOW)).toBe('14 min ago');
    expect(agoLabel(ago(59 * MIN), NOW)).toBe('59 min ago');
    expect(agoLabel(ago(60 * MIN), NOW)).toBe('1 hr ago');
    expect(agoLabel(ago(47 * HOUR), NOW)).toBe('47 hr ago');
    expect(agoLabel(ago(48 * HOUR), NOW)).toBe('2 days ago');
  });
  it('handles never, the future, and garbage', () => {
    expect(agoLabel(null, NOW)).toBe('never');
    expect(agoLabel(new Date(NOW.getTime() + MIN).toISOString(), NOW)).toBe('just now');
    expect(agoLabel('not a date', NOW)).toBe('never');
  });
});

describe('freshnessText (§8.1)', () => {
  it('says when the data was last updated', () => {
    expect(freshnessText(ago(2 * MIN), false, NOW)).toBe('Last updated 2 min ago');
  });
  it('warns when the data is stale', () => {
    expect(freshnessText(ago(14 * MIN), true, NOW)).toBe('Scores may be behind — last updated 14 min ago');
  });
  it('explains when there has never been any data', () => {
    expect(freshnessText(null, true, NOW)).toBe("Couldn't reach The Blue Alliance yet");
    expect(freshnessText(null, false, NOW)).toBe('No data from The Blue Alliance yet');
  });
});

describe('formatDateRange', () => {
  it('formats single days, ranges, and ranges across months and years', () => {
    expect(formatDateRange('2026-10-24', '2026-10-24')).toBe('Oct 24, 2026');
    expect(formatDateRange('2026-04-15', '2026-04-18')).toBe('Apr 15–18, 2026');
    expect(formatDateRange('2026-10-31', '2026-11-01')).toBe('Oct 31 – Nov 1, 2026');
    expect(formatDateRange('2026-12-31', '2027-01-01')).toBe('Dec 31, 2026 – Jan 1, 2027');
  });
});

describe('signed and lineText', () => {
  it('always shows a sign', () => {
    expect(signed(5)).toBe('+5');
    expect(signed(0)).toBe('+0');
    expect(signed(-3)).toBe('-3');
  });
  it('matches the breakdown format in the spec (§5.3)', () => {
    expect(lineText({ label: 'Qual record 7-2-0', points: 21 })).toBe('Qual record 7-2-0 → +21');
    expect(lineText({ label: 'Adjustment: Late to draft', points: -10 })).toBe('Adjustment: Late to draft → -10');
  });
});

describe('teamName', () => {
  it('adds the nickname when there is one', () => {
    expect(teamName('frc341', { frc341: 'Miss Daisy' })).toBe('341 Miss Daisy');
    expect(teamName('frc341B', {})).toBe('341B');
  });
});

describe('tbaEventUrl', () => {
  it('links to the event on TBA', () => {
    expect(tbaEventUrl('2025parr')).toBe('https://www.thebluealliance.com/event/2025parr');
  });
});

describe('roundKeyLine (SP2 final review, Minor 5)', () => {
  it('shows the event key for TBA rounds', () => {
    expect(roundKeyLine({ eventKey: '2026parr', kind: 'tba', seasonYear: null })).toBe('2026parr');
  });
  it('never leaves the line blank for manual and season rounds', () => {
    expect(roundKeyLine({ eventKey: null, kind: 'manual', seasonYear: null })).toBe('Manual event');
    expect(roundKeyLine({ eventKey: null, kind: 'season', seasonYear: 2027 })).toBe('2027 season');
  });
});

describe('shortDate / ordinal', () => {
  it('formats dates without timezone drift', () => {
    expect(shortDate('2026-10-24')).toBe('Oct 24');
    expect(shortDate('2026-01-01')).toBe('Jan 1');
  });
  it('handles English ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
  });
});
