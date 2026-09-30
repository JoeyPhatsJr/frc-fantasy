import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import { GET as lookUp } from '@/app/api/l/[slug]/admin/events/[eventKey]/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { setUser, signInAsMember } from '../helpers/auth';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;

const EVENT = {
  key: '2025parr',
  name: 'Ramp Riot',
  start_date: '2025-10-25',
  end_date: '2025-10-26',
  timezone: 'America/New_York',
  event_type: 99,
};

function tbaAnswers(answers: Record<string, unknown>) {
  h.getTba = vi.fn(async (path: unknown) => {
    const data = answers[String(path)];
    return { data: data ?? null, fetchedAt: '2026-10-01T12:00:00.000Z', stale: false };
  });
}

beforeEach(async () => {
  setUser(null);
  repo = createMemoryRepo();
  h.repo = repo;
  ({ league } = await seedLeague(repo));
  tbaAnswers({ '/event/2025parr': EVENT });
});

const at = (eventKey: string) => params({ slug: league.slug, eventKey });

describe('GET /admin/events/{eventKey}', () => {
  it('returns the event name and dates without adding a round', async () => {
    const res = await lookUp(request('GET', '/x', {}), at(' 2025PARR '));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({
      found: true,
      eventKey: '2025parr',
      name: 'Ramp Riot',
      startDate: '2025-10-25',
      endDate: '2025-10-26',
      alreadyInLeague: false,
    });
    expect(h.getTba).toHaveBeenCalledWith('/event/2025parr', expect.objectContaining({ windowMs: expect.any(Number) }));
    expect(await repo.listRounds(league.id)).toEqual([]);
  });

  it('answers found: false (200) when TBA has no such event', async () => {
    tbaAnswers({});
    const res = await lookUp(request('GET', '/x', {}), at('2026nope'));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ found: false, eventKey: '2026nope' });
  });

  it('answers found: false for an event POST /rounds would refuse (no usable dates)', async () => {
    tbaAnswers({ '/event/2025parr': { ...EVENT, start_date: null } });
    const res = await lookUp(request('GET', '/x', {}), at('2025parr'));
    expect(res.status).toBe(200);
    expect((await readJson(res)).found).toBe(false);
  });

  it('answers 503 when TBA cannot be reached', async () => {
    h.getTba = vi.fn(async () => ({ data: null, fetchedAt: null, stale: true }));
    const res = await lookUp(request('GET', '/x', {}), at('2025parr'));
    expect(res.status).toBe(503);
    expect((await readJson(res)).error).toBe("Couldn't reach The Blue Alliance. Try again in a minute.");
  });

  it('says when the event is already in this league', async () => {
    await repo.createRound({
      leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
      startDate: '2025-10-25', endDate: '2025-10-26', timezone: 'America/New_York',
      scoring: defaultScoring(),
    });
    const res = await lookUp(request('GET', '/x', {}), at('2025parr'));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({ found: true, alreadyInLeague: true });
  });

  it("does not count another league's round as already added", async () => {
    const other = await seedLeague(repo, { slug: 'other-league-bbbbbb', signIn: false });
    await repo.createRound({
      leagueId: other.league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
      startDate: '2025-10-25', endDate: '2025-10-26', timezone: 'America/New_York',
      scoring: defaultScoring(),
    });
    const res = await lookUp(request('GET', '/x', {}), at('2025parr'));
    expect((await readJson(res)).alreadyInLeague).toBe(false);
  });

  it('answers 400 for a malformed event key without calling TBA', async () => {
    for (const eventKey of ['parr', '2025 parr', '', 'https://tba/2025parr']) {
      const res = await lookUp(request('GET', '/x', {}), at(eventKey));
      expect(res.status, eventKey).toBe(400);
      expect((await readJson(res)).error).toBe('Event keys look like 2025parr');
    }
    expect(h.getTba).not.toHaveBeenCalled();
  });

  it('answers 401 signed out and 403 for a member who is not a commissioner, and does not call TBA', async () => {
    setUser(null);
    expect((await lookUp(request('GET', '/x'), at('2025parr'))).status).toBe(401);
    expect(h.getTba).not.toHaveBeenCalled();

    await signInAsMember(repo, league, 'Mom', 'player');
    expect((await lookUp(request('GET', '/x'), at('2025parr'))).status).toBe(403);
    expect(h.getTba).not.toHaveBeenCalled();
  });
});
