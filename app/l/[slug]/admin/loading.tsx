import { Skeleton } from '@/components/Skeleton';

/**
 * Commissioner pages while they load. Without this, app/l/[slug]/loading.tsx (a scoreboard shape)
 * would flash here too; admin pages are forms and lists, so a neutral shape fits better.
 */
export default function AdminLoading() {
  return (
    <main id="main">
      <div role="status" className="space-y-6">
        <span className="sr-only">Loading</span>
        <Skeleton className="h-11 w-28" />
        <Skeleton className="h-8 w-56" />
        <div className="space-y-3 rounded-card border border-border bg-surface p-4 shadow-card">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-2/3" />
        </div>
        <div className="space-y-3 rounded-card border border-border bg-surface p-4 shadow-card">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
    </main>
  );
}
