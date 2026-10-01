export type SeasonTotals = { points: number; events: number };

/**
 * Projected fantasy points per event for a draft in season Y (spec §6.1):
 * (2 × points[Y] + points[Y−1]) / (2 × events[Y] + events[Y−1]), rounded to 1 decimal.
 * A missing season counts as 0 points over 0 events. Null means "New" (no events at all).
 */
export function projection(cur: SeasonTotals | null, prev: SeasonTotals | null): number | null {
  const c = cur ?? { points: 0, events: 0 };
  const p = prev ?? { points: 0, events: 0 };
  const events = 2 * c.events + p.events;
  if (events <= 0) return null;
  return Math.round(((2 * c.points + p.points) / events) * 10) / 10;
}
