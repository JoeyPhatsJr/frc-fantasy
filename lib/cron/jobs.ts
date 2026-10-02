import { autoFinalizeJob } from '@/lib/cron/autoFinalize';
import { getRepo } from '@/lib/db';
import { followSyncJob } from '@/lib/follow/sync';
import { localDate } from '@/lib/rounds/status';
import { seasonDatesJob } from '@/lib/season/jobs';
import { refreshRecentTeams } from '@/lib/stats/build';

/** One piece of daily work. It must stop on its own once Date.now() >= deadline. */
export type DailyJob = { name: string; run(now: Date, deadline: number): Promise<void> };

export type JobResult = { name: string; ok: boolean; skipped: boolean; error?: string; ms: number };

/**
 * Everything /api/cron/daily does, in order. The cheap, bounded jobs (follow-a-team sync: one TBA list
 * per follow; season-round dates: one per year; auto-finalize: one DB read, then at most two cached TBA
 * reads per just-ended TBA round) run before team-stats, which may use the whole budget during build
 * season (final review I5). Auto-finalize runs after season-dates so season rounds are judged by a
 * fresh end_date (auto-finalize review M2).
 */
export const DAILY_JOBS: DailyJob[] = [
  followSyncJob,
  seasonDatesJob,
  autoFinalizeJob,
  {
    name: 'team-stats',
    async run(now, deadline) {
      const season = Number(localDate(now, 'America/New_York').slice(0, 4));
      const res = await refreshRecentTeams(season, { repo: getRepo(), now }, deadline);
      console.log(
        `team-stats ${season}: ${res.eventsRefreshed}/${res.events} recent events loaded, ${res.teams} teams, ${res.remaining} left` +
          (res.complete ? '' : ' (time budget reached; the next run continues)'),
      );
    },
  },
];

export async function runDailyJobs(
  jobs: DailyJob[],
  now: Date,
  deadline: number,
  clock: () => number = Date.now,
): Promise<JobResult[]> {
  const results: JobResult[] = [];
  for (const job of jobs) {
    const start = clock();
    if (start >= deadline) {
      results.push({ name: job.name, ok: true, skipped: true, ms: 0 });
      continue;
    }
    try {
      await job.run(now, deadline);
      results.push({ name: job.name, ok: true, skipped: false, ms: clock() - start });
    } catch (err) {
      console.error(`Cron job ${job.name} failed`, err);
      results.push({
        name: job.name,
        ok: false,
        skipped: false,
        error: err instanceof Error ? err.message : String(err),
        ms: clock() - start,
      });
    }
  }
  return results;
}
