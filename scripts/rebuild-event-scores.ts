// Empties the derived event_scores cache. Safe at any time: pages and the cron re-score events on demand.
// Use it after changing scoring code (lib/scoring/*), since cached rows were computed by the old code.
// Usage: npx tsx --env-file=.env.local scripts/rebuild-event-scores.ts
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';

async function main() {
  const repo = createSupabaseRepo(createSupabaseClient());
  const deleted = await repo.clearEventScores();
  console.log(`Deleted ${deleted} event_scores rows. They refill on the next page views and cron run.`);
  console.log('team_stats was not touched; rerun scripts/build-team-stats.ts <season> to recompute it.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
