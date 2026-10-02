import { describe, expect, it } from 'vitest';
import { adminStep, setupDone, stepDone, STEP_TITLE } from '@/lib/admin/steps';

describe('setupDone', () => {
  it('needs a roster size and every current player in the draft order', () => {
    expect(setupDone({ draftOrder: ['a', 'b'], rosterSize: 3 }, ['a', 'b'])).toBe(true);
    expect(setupDone({ draftOrder: ['b', 'a', 'x'], rosterSize: 3 }, ['a', 'b'])).toBe(true);
    expect(setupDone({ draftOrder: ['a'], rosterSize: 3 }, ['a', 'b'])).toBe(false);
    expect(setupDone({ draftOrder: [], rosterSize: 3 }, [])).toBe(false);
    expect(setupDone({ draftOrder: ['a', 'b'], rosterSize: 0 }, ['a', 'b'])).toBe(false);
  });
});

describe('adminStep', () => {
  it('maps round status to the open step', () => {
    expect(adminStep('setup', false)).toBe(1);
    expect(adminStep('setup', true)).toBe(2);
    expect(adminStep('drafting', false)).toBe(2);
    expect(adminStep('drafting', true)).toBe(2);
    expect(adminStep('upcoming', true)).toBe(3);
    expect(adminStep('live', true)).toBe(3);
    expect(adminStep('awaiting_final', true)).toBe(4);
    expect(adminStep('final', true)).toBe(4);
  });
});

describe('stepDone', () => {
  it('earlier steps are done', () => {
    expect(stepDone(1, 2)).toBe(true);
    expect(stepDone(2, 2)).toBe(false);
    expect(stepDone(4, 3)).toBe(false);
  });
  it('has a title for each step', () => {
    expect(STEP_TITLE).toEqual({ 1: 'Set up', 2: 'Run the draft', 3: 'During the event', 4: 'Wrap up' });
  });
});
