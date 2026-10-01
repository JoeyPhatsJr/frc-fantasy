import { handle, HttpError, json } from '@/lib/api/http';
import { cronAuthorized } from '@/lib/cron/auth';
import { DAILY_JOBS, runDailyJobs } from '@/lib/cron/jobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Spec §6.2: stop starting work at 50 s so the 60 s function always finishes cleanly. */
const BUDGET_MS = 50_000;

export async function GET(req: Request): Promise<Response> {
  return handle(async () => {
    if (!cronAuthorized(req.headers.get('authorization'), process.env.CRON_SECRET)) {
      throw new HttpError(401, 'Unauthorized');
    }
    const started = Date.now();
    const results = await runDailyJobs(DAILY_JOBS, new Date(started), started + BUDGET_MS);
    return json({ ok: results.every((r) => r.ok), results });
  });
}
