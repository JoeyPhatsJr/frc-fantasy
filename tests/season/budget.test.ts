import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFetchBudget, SEASON_BUDGET } from '@/lib/season/budget';

/** A promise you resolve by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
/** Lets queued promise callbacks run (timers are faked, so no setTimeout). */
const tick = () => vi.advanceTimersByTimeAsync(0);

describe('createFetchBudget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('matches the spec: 4 in flight, 6 seconds', () => {
    expect(SEASON_BUDGET).toEqual({ maxInFlight: 4, budgetMs: 6_000 });
  });

  it('never runs more than maxInFlight live tasks at once', async () => {
    const budget = createFetchBudget({ maxInFlight: 4, budgetMs: 60_000 });
    let inFlight = 0;
    let most = 0;
    const gates = Array.from({ length: 10 }, () => deferred<void>());
    const all = gates.map((g, i) =>
      budget.run(
        async () => {
          inFlight++;
          most = Math.max(most, inFlight);
          await g.promise;
          inFlight--;
          return `live ${i}`;
        },
        async () => `fallback ${i}`,
      ),
    );
    await tick();
    expect(inFlight).toBe(4);
    gates.forEach((g) => g.resolve());
    expect(await Promise.all(all)).toEqual(gates.map((_, i) => `live ${i}`));
    expect(most).toBe(4);
  });

  it('uses the fallback once the budget is spent, even for tasks already waiting (Review Focus 4)', async () => {
    let now = 0;
    const budget = createFetchBudget({ maxInFlight: 1, budgetMs: 6_000, clock: () => now });
    const slow = deferred<string>();
    const first = budget.run(() => slow.promise, async () => 'fallback 1');
    const second = budget.run(async () => 'live 2', async () => 'fallback 2'); // waits for the slot
    now = 6_000; // the budget runs out while the first fetch is still going
    slow.resolve('live 1');
    expect(await first).toBe('live 1'); // a fetch that already started finishes (TBA's own 5 s timeout bounds it)
    expect(await second).toBe('fallback 2');
    expect(await budget.run(async () => 'live 3', async () => 'fallback 3')).toBe('fallback 3');
  });

  it('runs the budget on the real (faked) clock by default', async () => {
    const budget = createFetchBudget({ maxInFlight: 2, budgetMs: 6_000 });
    expect(await budget.run(async () => 'live', async () => 'fallback')).toBe('live');
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await budget.run(async () => 'live', async () => 'fallback')).toBe('fallback');
  });

  it('frees the slot when a live task throws', async () => {
    const budget = createFetchBudget({ maxInFlight: 1, budgetMs: 60_000 });
    await expect(budget.run(async () => { throw new Error('boom'); }, async () => 'x')).rejects.toThrow('boom');
    expect(await budget.run(async () => 'live', async () => 'fallback')).toBe('live');
  });
});
