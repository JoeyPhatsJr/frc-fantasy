import { describe, expect, it } from 'vitest';
import { autoFinalDecision, BACKSTOP_DAYS, draftComplete, type AutoFinalInput } from '@/lib/rounds/autoFinal';

const base: AutoFinalInput = {
  kind: 'tba', endDate: '2026-10-24', timezone: 'America/New_York',
  finalizedAt: null, autoFinalize: true, draftComplete: true,
};
// 10:00 UTC = 6 am Eastern, when the daily cron runs.
const at = (ymd: string) => new Date(`${ymd}T10:00:00Z`);

describe('draftComplete', () => {
  it('needs every pick made and at least one pick slot', () => {
    expect(draftComplete({ draftOrder: ['a', 'b'], rosterSize: 2 }, 4)).toBe(true);
    expect(draftComplete({ draftOrder: ['a', 'b'], rosterSize: 2 }, 3)).toBe(false);
    expect(draftComplete({ draftOrder: [], rosterSize: 2 }, 0)).toBe(false);
  });
});

describe('autoFinalDecision', () => {
  it('waits during and on the last day of the event', () => {
    expect(autoFinalDecision(base, at('2026-10-23'))).toBe('wait');
    expect(autoFinalDecision(base, at('2026-10-24'))).toBe('wait');
  });
  it('asks TBA about the finals from the day after the event', () => {
    expect(autoFinalDecision(base, at('2026-10-25'))).toBe('needs-finals-check');
    expect(autoFinalDecision(base, at('2026-10-26'))).toBe('needs-finals-check');
  });
  it(`finalizes any round ${BACKSTOP_DAYS} days after the event`, () => {
    expect(autoFinalDecision(base, at('2026-10-27'))).toBe('finalize');
    expect(autoFinalDecision({ ...base, kind: 'manual' }, at('2026-10-27'))).toBe('finalize');
    expect(autoFinalDecision({ ...base, kind: 'season' }, at('2026-10-27'))).toBe('finalize');
  });
  it('manual and season rounds never ask TBA, they only use the backstop', () => {
    expect(autoFinalDecision({ ...base, kind: 'manual' }, at('2026-10-25'))).toBe('wait');
    expect(autoFinalDecision({ ...base, kind: 'season' }, at('2026-10-26'))).toBe('wait');
  });
  it('leaves final, reopened and undrafted rounds alone', () => {
    const late = at('2026-11-30');
    expect(autoFinalDecision({ ...base, finalizedAt: '2026-10-27T10:00:00Z' }, late)).toBe('wait');
    expect(autoFinalDecision({ ...base, autoFinalize: false }, late)).toBe('wait');
    expect(autoFinalDecision({ ...base, draftComplete: false }, late)).toBe('wait');
  });
  it('uses the event timezone: 11:30 pm Pacific on the last day is still the last day', () => {
    const west = { ...base, timezone: 'America/Los_Angeles' };
    expect(autoFinalDecision(west, new Date('2026-10-25T06:30:00Z'))).toBe('wait');
    expect(autoFinalDecision(west, new Date('2026-10-25T08:30:00Z'))).toBe('needs-finals-check');
  });
  it('falls back to Eastern when the timezone is unknown', () => {
    expect(autoFinalDecision({ ...base, timezone: null }, at('2026-10-25'))).toBe('needs-finals-check');
  });
});
