import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ jobs: [] as { name: string; run: (now: Date, deadline: number) => Promise<void> }[] }));
vi.mock('@/lib/db', () => ({ getRepo: () => ({}) }));
vi.mock('@/lib/cron/jobs', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/cron/jobs')>();
  return { ...real, DAILY_JOBS: h.jobs };
});

import * as route from '@/app/api/cron/daily/route';
import { cronAuthorized } from '@/lib/cron/auth';
import { runDailyJobs } from '@/lib/cron/jobs';

const SECRET = 'a-long-random-cron-secret-0123456789';
const get = (auth?: string) =>
  route.GET(new Request('http://test.local/api/cron/daily', { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  h.jobs.length = 0;
  vi.stubEnv('CRON_SECRET', SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('cronAuthorized', () => {
  it('accepts only the exact bearer header', () => {
    expect(cronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(cronAuthorized(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(cronAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(cronAuthorized(null, SECRET)).toBe(false);
  });

  it('refuses everything when CRON_SECRET is not set', () => {
    expect(cronAuthorized('Bearer ', undefined)).toBe(false);
    expect(cronAuthorized('Bearer undefined', undefined)).toBe(false);
    expect(cronAuthorized('Bearer ', '')).toBe(false);
  });
});

describe('GET /api/cron/daily', () => {
  it('is dynamic and allowed 60 s (spec §3)', () => {
    expect(route.dynamic).toBe('force-dynamic');
    expect(route.maxDuration).toBe(60);
  });

  it.each([
    ['no header', undefined],
    ['a wrong secret', 'Bearer nope'],
  ])('answers 401 with %s and runs nothing', async (_label, auth) => {
    const run = vi.fn(async () => {});
    h.jobs.push({ name: 'x', run });
    const res = await get(auth);
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('answers 401 when CRON_SECRET is unset, even for "Bearer undefined"', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await get('Bearer undefined')).status).toBe(401);
  });

  it('runs every job in order with a deadline 50 s out, and keeps going after a failure', async () => {
    const order: string[] = [];
    const deadlines: number[] = [];
    h.jobs.push(
      { name: 'first', run: async (_now, d) => { order.push('first'); deadlines.push(d); throw new Error('boom'); } },
      { name: 'second', run: async (_now, d) => { order.push('second'); deadlines.push(d); } },
    );
    const before = Date.now();
    const res = await get(`Bearer ${SECRET}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(order).toEqual(['first', 'second']);
    expect(deadlines[0]).toBeGreaterThanOrEqual(before + 50_000);
    expect(deadlines[0]).toBeLessThanOrEqual(Date.now() + 50_000);
    expect(body.ok).toBe(false);
    expect(body.results.map((r: { name: string; ok: boolean }) => [r.name, r.ok])).toEqual([['first', false], ['second', true]]);
    expect(body.results[0].error).toBe('boom');
  });
});

describe('runDailyJobs', () => {
  it('skips jobs that would start after the deadline', async () => {
    let t = 0;
    const clock = () => t;
    const ran: string[] = [];
    const results = await runDailyJobs(
      [
        { name: 'slow', run: async () => { ran.push('slow'); t = 60_000; } },
        { name: 'late', run: async () => { ran.push('late'); } },
      ],
      new Date(0),
      50_000,
      clock,
    );
    expect(ran).toEqual(['slow']);
    expect(results[1]).toMatchObject({ name: 'late', skipped: true, ok: true });
  });
});

describe('vercel.json', () => {
  it('schedules the cron once a day at 10:00 UTC', () => {
    const cfg = JSON.parse(readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8'));
    expect(cfg.crons).toEqual([{ path: '/api/cron/daily', schedule: '0 10 * * *' }]);
  });
});
