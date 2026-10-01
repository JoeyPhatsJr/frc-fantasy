export type FetchBudget = {
  /** Runs `live` if the budget allows (waiting for a free slot), otherwise `fallback`. */
  run<T>(live: () => Promise<T>, fallback: () => Promise<T>): Promise<T>;
};

/** Spec §5.5: a season page refreshes at most 4 events at once and stops refreshing after 6 seconds. */
export const SEASON_BUDGET = { maxInFlight: 4, budgetMs: 6_000 } as const;

export function createFetchBudget(opts: { maxInFlight: number; budgetMs: number; clock?: () => number }): FetchBudget {
  const clock = opts.clock ?? Date.now;
  const deadline = clock() + opts.budgetMs;
  const spent = () => clock() >= deadline;
  let inFlight = 0;
  const waiting: (() => void)[] = [];

  // A finished task hands its slot straight to the next waiter, so `inFlight` never exceeds the cap.
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else inFlight--;
  };

  return {
    async run(live, fallback) {
      if (spent()) return fallback();
      if (inFlight < opts.maxInFlight) {
        inFlight++; // taken synchronously, so a free slot starts `live` right away
      } else {
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
      try {
        // The budget may have run out while this task waited for a slot.
        return spent() ? await fallback() : await live();
      } finally {
        release();
      }
    },
  };
}
