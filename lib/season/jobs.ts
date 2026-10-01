import type { DailyJob } from '@/lib/cron/jobs';
import { getRepo } from '@/lib/db';
import { fetchSeasonDates } from '@/lib/season/fetchDates';

/**
 * Daily cron job (spec §5.5): keep open season rounds' dates on TBA's official calendar.
 * One TBA call per season year (each capped at 5 s by the client); stops at the deadline.
 */
export const seasonDatesJob: DailyJob = {
  name: 'season-dates',
  async run(_now: Date, deadline: number): Promise<void> {
    const repo = getRepo();
    const byYear = new Map<number, Awaited<ReturnType<typeof fetchSeasonDates>>>();
    for (const round of await repo.listOpenSeasonRounds()) {
      if (Date.now() >= deadline) break;
      if (round.seasonYear === null) continue;
      if (!byYear.has(round.seasonYear)) byYear.set(round.seasonYear, await fetchSeasonDates(round.seasonYear));
      const dates = byYear.get(round.seasonYear)!;
      // TBA down: keep what we have rather than falling back to Jan 1 – Dec 31.
      if (dates.stale) continue;
      if (dates.startDate !== round.startDate || dates.endDate !== round.endDate) {
        await repo.updateRound(round.id, { startDate: dates.startDate, endDate: dates.endDate });
      }
    }
  },
};
