import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));

import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { getEventScores } from '@/lib/scores/eventScores';
import { configHash } from '@/lib/scores/hash';
import type { EventData } from '@/lib/tba/types';
import { loadFixture } from '../helpers/fixture';
import { createMemoryRepo } from '../helpers/memoryRepo';

const NOW = new Date('2026-10-01T16:00:00.000Z');
const fixture = loadFixture('2025parr');
const SUFFIX: Record<string, keyof EventData> = {
  'teams/simple': 'teams', 'matches/simple': 'matches', rankings: 'rankings',
  alliances: 'alliances', awards: 'awards', oprs: 'oprs',
};

beforeEach(() => {
  h.repo = createMemoryRepo();
  vi.stubEnv('TBA_API_KEY', 'test-key');
  vi.stubGlobal('fetch', (async (url: string | URL | Request) => {
    const name = SUFFIX[/\/event\/2025parr\/(.+)$/.exec(String(url))![1]];
    return new Response(JSON.stringify(fixture[name]), { status: 200, headers: { etag: '"f"' } });
  }) as typeof fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('event_scores is rebuildable', () => {
  it('gives identical scores after the table is cleared, and refills it', async () => {
    const repo = h.repo as ReturnType<typeof createMemoryRepo>;
    const before = await getEventScores('2025parr', DEFAULT_SCORING, 600_000, { now: NOW });

    expect(await repo.clearEventScores()).toBe(1);
    const after = await getEventScores('2025parr', DEFAULT_SCORING, 600_000, { now: NOW });

    expect(after.scores).toEqual(before.scores);
    expect(await repo.getEventScoresRow('2025parr', configHash(DEFAULT_SCORING))).not.toBeNull();
  });
});
