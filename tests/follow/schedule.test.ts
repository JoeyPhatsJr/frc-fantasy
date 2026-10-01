import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
  afterCalls: [] as (() => unknown)[],
  afterThrows: false,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));
vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    // Next.js throws like this when after() runs outside a request (e.g. a page rendered in a test).
    if (h.afterThrows) throw new Error('`after` was called outside a request scope.');
    h.afterCalls.push(fn);
  },
}));

import { DAILY_JOBS } from '@/lib/cron/jobs';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { followSyncJob, scheduleFollowSync, shouldSyncOnVisit } from '@/lib/follow/sync';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

const NOW = new Date('2026-10-10T14:00:00.000Z');
let repo: Repo;
let league: LeagueRow;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  h.afterCalls = [];
  h.afterThrows = false;
  h.getTba = vi.fn(async () => ({ data: [], fetchedAt: NOW.toISOString(), stale: false }));
  ({ league } = await seedLeague(repo));
});

describe('shouldSyncOnVisit', () => {
  const at = (iso: string | null): LeagueRow => ({ ...league, followsSyncedAt: iso });
  it('syncs a league that never synced or synced over 10 minutes ago', () => {
    expect(shouldSyncOnVisit(at(null), NOW)).toBe(true);
    expect(shouldSyncOnVisit(at('2026-10-10T13:49:59.000Z'), NOW)).toBe(true);
  });
  it('waits when the last sync was within 10 minutes', () => {
    expect(shouldSyncOnVisit(at('2026-10-10T13:50:01.000Z'), NOW)).toBe(false);
  });
  it('never syncs a season league', () => {
    expect(shouldSyncOnVisit({ ...at(null), format: 'season' }, NOW)).toBe(false);
  });
});

describe('scheduleFollowSync', () => {
  it('queues the sync after the response, and a failing sync never throws', async () => {
    await repo.setFollows(league.id, [5181]);
    h.getTba = vi.fn(async () => {
      throw new Error('boom');
    });
    scheduleFollowSync(league, NOW);
    expect(h.afterCalls).toHaveLength(1);
    await expect(Promise.resolve(h.afterCalls[0]())).resolves.toBeUndefined();
  });

  it('queues nothing when the league synced recently', () => {
    scheduleFollowSync({ ...league, followsSyncedAt: NOW.toISOString() }, NOW);
    expect(h.afterCalls).toHaveLength(0);
  });

  it('never throws when after() itself refuses, so the page still renders', () => {
    h.afterThrows = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => scheduleFollowSync(league, NOW)).not.toThrow();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});

describe('followSyncJob', () => {
  it('syncs every league that follows someone', async () => {
    await repo.setFollows(league.id, [5181]);
    await followSyncJob.run(NOW, Date.now() + 60_000);
    expect((await repo.getLeagueBySlug(league.slug))!.followsSyncedAt).toBe(NOW.toISOString());
  });

  it('runs in the daily cron, before team-stats (final review I5)', () => {
    const names = DAILY_JOBS.map((j) => j.name);
    expect(DAILY_JOBS).toContain(followSyncJob);
    expect(names.indexOf('follow-sync')).toBeLessThan(names.indexOf('team-stats'));
    expect(names.indexOf('follow-sync')).toBeGreaterThanOrEqual(0);
  });

  it('stops when the deadline has passed', async () => {
    await repo.setFollows(league.id, [5181]);
    await followSyncJob.run(NOW, Date.now() - 1);
    expect((await repo.getLeagueBySlug(league.slug))!.followsSyncedAt).toBeNull();
  });
});
