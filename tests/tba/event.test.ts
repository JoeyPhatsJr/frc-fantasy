import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import { eventPaths, loadEventData } from '@/lib/tba/event';

beforeEach(() => {
  h.getTba = vi.fn(async (path: unknown) => ({
    data: { from: path },
    fetchedAt: '2026-10-24T18:00:00.000Z',
    stale: false,
  }));
});

describe('eventPaths', () => {
  it('lists the six per-event endpoints (§7.2)', () => {
    expect(eventPaths('2025parr')).toEqual({
      teams: '/event/2025parr/teams/simple',
      matches: '/event/2025parr/matches/simple',
      rankings: '/event/2025parr/rankings',
      alliances: '/event/2025parr/alliances',
      awards: '/event/2025parr/awards',
      oprs: '/event/2025parr/oprs',
    });
  });
});

describe('loadEventData', () => {
  it('fetches all six sections with the same options', async () => {
    const out = await loadEventData('2025parr', { windowMs: 60_000, force: true });
    expect(h.getTba).toHaveBeenCalledTimes(6);
    for (const path of Object.values(eventPaths('2025parr'))) {
      expect(h.getTba).toHaveBeenCalledWith(path, { windowMs: 60_000, force: true });
    }
    expect(out.data.rankings).toEqual({ from: '/event/2025parr/rankings' });
    expect(out.stale).toBe(false);
  });

  it('reports the oldest fetch time', async () => {
    h.getTba = vi.fn(async (path: unknown) => ({
      data: null,
      fetchedAt: String(path).endsWith('/oprs') ? '2026-10-24T17:40:00.000Z' : '2026-10-24T18:00:00.000Z',
      stale: false,
    }));
    const out = await loadEventData('2025parr', { windowMs: 60_000 });
    expect(out.fetchedAt).toBe('2026-10-24T17:40:00.000Z');
  });

  it('is stale if any section is stale', async () => {
    h.getTba = vi.fn(async (path: unknown) => ({
      data: null,
      fetchedAt: String(path).endsWith('/awards') ? null : '2026-10-24T18:00:00.000Z',
      stale: String(path).endsWith('/awards'),
    }));
    const out = await loadEventData('2025parr', { windowMs: 60_000 });
    expect(out.stale).toBe(true);
    expect(out.fetchedAt).toBe('2026-10-24T18:00:00.000Z');
  });

  it('has a null fetch time when nothing was ever fetched', async () => {
    h.getTba = vi.fn(async () => ({ data: null, fetchedAt: null, stale: true }));
    const out = await loadEventData('2025parr', { windowMs: 60_000 });
    expect(out.fetchedAt).toBeNull();
    expect(out.data).toEqual({
      teams: null, matches: null, rankings: null, alliances: null, awards: null, oprs: null,
    });
  });
});
