'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { RefreshCw, TriangleAlert } from '@/components/ui/icons';

// In production Next.js hides the real error message from the browser, so every failure gets this
// one friendly page; by far the most likely cause is the paused Supabase database (spec §8.2).
export default function LeagueError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="space-y-6">
      <Card className="space-y-4 border-t-4 border-t-accent">
        <TriangleAlert className="size-8 text-warning" />
        <h1 className="break-words font-display text-3xl font-bold uppercase leading-tight tracking-wide text-fg">
          The league database is asleep
        </h1>
        <p className="text-fg">The commissioner needs to wake it up. Your picks and scores are safe.</p>
        <p className="text-sm text-fg-muted">
          If you are the commissioner: open the Supabase dashboard and press &ldquo;Restore project&rdquo;, wait
          a minute, then try again.
        </p>
        <Button type="button" onClick={reset}>
          <RefreshCw className="size-4 shrink-0" />
          Try again
        </Button>
      </Card>
    </main>
  );
}
