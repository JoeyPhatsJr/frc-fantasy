import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ getRepo: () => ({}) }));

import { DAILY_JOBS, runDailyJobs } from '@/lib/cron/jobs';

// Final review I5: team-stats can use the whole cron budget during build season, so the two cheap,
// bounded jobs run first and are never skipped behind it.
describe('DAILY_JOBS order', () => {
  it('runs follow-sync and season-dates before team-stats', () => {
    // Final review M2: auto-finalize reads season rounds' end_date, so it runs after season-dates refreshes it.
    expect(DAILY_JOBS.map((j) => j.name)).toEqual(['follow-sync', 'season-dates', 'auto-finalize', 'team-stats']);
  });

  it('team-stats spending the whole budget skips none of the cheap jobs', async () => {
    let t = 0;
    const deadline = 50_000;
    // Same names and order as the real list; team-stats eats every millisecond left.
    const jobs = DAILY_JOBS.map((j) => ({
      name: j.name,
      run: async () => {
        t = j.name === 'team-stats' ? deadline : t + 100;
      },
    }));
    const results = await runDailyJobs(jobs, new Date('2027-03-10T09:00:00Z'), deadline, () => t);
    expect(results.map((r) => [r.name, r.skipped])).toEqual([
      ['follow-sync', false],
      ['season-dates', false],
      ['auto-finalize', false],
      ['team-stats', false],
    ]);
  });
});
