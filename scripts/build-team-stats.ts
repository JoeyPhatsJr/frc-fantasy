// Builds team_stats for one season from TBA (spec §6.2), ~5 requests/s.
// Safe to stop and rerun: finished work is read back from tba_cache instead of TBA.
// Usage: npx tsx --env-file=.env.local scripts/build-team-stats.ts 2025
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';
import { buildSeasonStats } from '@/lib/stats/build';
import { throttleFetch } from '@/lib/tba/throttle';

async function main() {
  const season = Number(process.argv[2]);
  if (!Number.isInteger(season) || season < 1992 || season > 2100) {
    throw new Error('Usage: build-team-stats.ts <season>   e.g. 2025');
  }
  if (!process.env.TBA_API_KEY) throw new Error('TBA_API_KEY is not set. Put it in .env.local.');

  const repo = createSupabaseRepo(createSupabaseClient());
  const started = Date.now();
  const result = await buildSeasonStats(
    season,
    { repo, now: new Date(), tba: { fetchImpl: throttleFetch(fetch, 5) } },
    { log: (line) => console.log(line) },
  );
  const secs = Math.round((Date.now() - started) / 1000);
  console.log(
    `Done: ${season} — ${result.events} events, ${result.teams} team rows, ` +
      `${result.skipped.length} events with no played quals (${secs} s).`,
  );
  if (result.events === 0) console.log(`TBA returned no events for ${season}. Is the season published yet?`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
