/** A placeholder block while a page loads. Decorative; the container announces the loading state. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={['block rounded-lg bg-surface-2 motion-safe:animate-pulse', className].filter(Boolean).join(' ')}
    />
  );
}

/** A card of scoreboard-shaped rows: rank circle, name and detail lines, big score. */
export function ScoreboardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" className="rounded-card border border-border bg-surface p-4 shadow-card">
      <span className="sr-only">Loading</span>
      <Skeleton className="mb-4 h-6 w-40" />
      <ul className="space-y-2">
        {Array.from({ length: rows }, (_, i) => (
          <li
            key={i}
            data-skeleton-row
            className="flex min-h-14 items-center gap-3 rounded-xl border border-border px-3 py-2"
          >
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <span className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </span>
            <Skeleton className="h-7 w-12 shrink-0" />
          </li>
        ))}
      </ul>
    </div>
  );
}
