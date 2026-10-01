import { describe, expect, it } from 'vitest';
import { actionNotice, MAX_QUEUE, toggledQueue } from '@/components/draft/DraftRoom';
import { DraftApiError } from '@/lib/draft/api';

describe('actionNotice (§7.6)', () => {
  it('stays quiet on stale and not_your_turn 409s: the refetch shows what changed', () => {
    expect(actionNotice(new DraftApiError(409, 'Draft changed in another tab — refresh', 'stale'), 'frc341')).toBeNull();
    expect(actionNotice(new DraftApiError(409, "It's not your turn", 'not_your_turn'), 'frc341')).toBeNull();
  });
  it('names the team when someone else just took it', () => {
    expect(actionNotice(new DraftApiError(409, 'That team was just taken', 'taken'), 'frc341')).toBe(
      '341 was just taken — pick again',
    );
  });
  it("shows the server's message for other API errors, including taken without a picked team", () => {
    expect(actionNotice(new DraftApiError(409, "The draft isn't running right now", 'not_live'), 'frc341')).toBe(
      "The draft isn't running right now",
    );
    expect(actionNotice(new DraftApiError(409, 'That team was just taken', 'taken'))).toBe('That team was just taken');
    expect(actionNotice(new DraftApiError(403, 'Only the commissioner can do that'))).toBe(
      'Only the commissioner can do that',
    );
  });
  it('blames the connection for anything that is not an API answer', () => {
    expect(actionNotice(new TypeError('Failed to fetch'))).toBe(
      "Couldn't reach the server. Check your connection and try again.",
    );
  });
});

describe('toggledQueue', () => {
  it('adds a team to the end, or removes it if it is already queued', () => {
    expect(toggledQueue(['frc341', 'frc254'], 'frc1114')).toEqual(['frc341', 'frc254', 'frc1114']);
    expect(toggledQueue(['frc341', 'frc254', 'frc1114'], 'frc254')).toEqual(['frc341', 'frc1114']);
  });
  it(`refuses to grow past ${MAX_QUEUE} teams but still lets a full queue shrink`, () => {
    const full = Array.from({ length: MAX_QUEUE }, (_, i) => `frc${i + 1}`);
    expect(toggledQueue(full, 'frc9999')).toBeNull();
    expect(toggledQueue(full, 'frc1')).toHaveLength(MAX_QUEUE - 1);
  });
});
