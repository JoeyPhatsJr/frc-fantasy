'use client';

import { useCallback, useState } from 'react';
import type { SectionProps } from '@/components/admin/RoundAdmin';

/**
 * Remembers which control started the running change, so that one control shows the spinner while
 * `busy` (from the round page) disables all the others. Wraps the page's `run` without changing it.
 */
export function usePending(run: SectionProps['run']) {
  const [pending, setPending] = useState<string | null>(null);
  const go = useCallback(
    async (key: string, action: () => Promise<unknown>, done?: string) => {
      setPending(key);
      try {
        await run(action, done);
      } finally {
        setPending(null);
      }
    },
    [run],
  );
  return { pending, go };
}
