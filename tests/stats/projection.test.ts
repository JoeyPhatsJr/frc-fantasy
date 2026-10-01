import { describe, expect, it } from 'vitest';
import { projection } from '@/lib/stats/projection';

describe('projection (spec §6.1)', () => {
  it('weights the draft season twice as much as the season before', () => {
    // (2 × 40 + 30) / (2 × 2 + 1) = 110 / 5
    expect(projection({ points: 40, events: 2 }, { points: 30, events: 1 })).toBe(22);
  });

  it('uses whichever season exists', () => {
    expect(projection({ points: 80, events: 2 }, null)).toBe(40);
    expect(projection(null, { points: 90, events: 3 })).toBe(30);
  });

  it('rounds to one decimal', () => {
    expect(projection({ points: 10, events: 3 }, null)).toBe(3.3);
    expect(projection({ points: 0, events: 0 }, { points: 101, events: 3 })).toBe(33.7);
  });

  it('is null ("New") when no events were played in either season', () => {
    expect(projection(null, null)).toBeNull();
    expect(projection({ points: 0, events: 0 }, { points: 0, events: 0 })).toBeNull();
  });
});
