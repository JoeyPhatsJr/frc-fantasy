import { ScoreboardSkeleton, Skeleton } from '@/components/Skeleton';

/** A round page while it loads: title block, then the scoreboard. */
export default function RoundLoading() {
  return (
    <main id="main" className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <Skeleton className="h-[30px] flex-1" />
          <Skeleton className="h-[22px] w-16 rounded-pill" />
        </div>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-56 rounded-pill" />
      </div>
      <ScoreboardSkeleton />
    </main>
  );
}
