import { ScoreboardSkeleton, Skeleton } from '@/components/Skeleton';

/** Standings while the page loads (the league bar and tabs are already on screen). */
export default function LeagueLoading() {
  return (
    <main id="main" className="space-y-6">
      <Skeleton className="h-4 w-48" />
      <ScoreboardSkeleton />
    </main>
  );
}
