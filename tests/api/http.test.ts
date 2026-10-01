import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import {
  DB_ASLEEP_MESSAGE,
  handle,
  HttpError,
  isUuid,
  json,
  parseBody,
  requireRound,
} from '@/lib/api/http';
import { DbUnavailableError, UniqueViolation, type Repo } from '@/lib/db/repo';
import { defaultScoring } from '@/lib/scoring/config';
import { readJson, request, seedLeague } from '../helpers/api';
import { setUser } from '../helpers/auth';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;

beforeEach(() => {
  setUser(null);
  repo = createMemoryRepo();
  h.repo = repo;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

async function status(err: unknown): Promise<[number, string]> {
  const res = await handle(async () => {
    throw err;
  });
  return [res.status, (await readJson(res)).error];
}

describe('handle', () => {
  it('passes a normal response through', async () => {
    const res = await handle(async () => json({ ok: true }, 201));
    expect(res.status).toBe(201);
    expect(await readJson(res)).toEqual({ ok: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('turns an HttpError into its status and message', async () => {
    expect(await status(new HttpError(409, 'Draft is full'))).toEqual([409, 'Draft is full']);
  });

  it('adds the error code to the body when an HttpError has one', async () => {
    const res = await handle(async () => {
      throw new HttpError(409, 'That team was just taken', 'taken');
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'That team was just taken', code: 'taken' });
    const plain = await handle(async () => {
      throw new HttpError(404, 'Round not found');
    });
    expect(await plain.json()).toEqual({ error: 'Round not found' });
  });

  it('maps unique constraints to the spec messages (§8.4)', async () => {
    expect(await status(new UniqueViolation('picks_round_team_key'))).toEqual([409, 'That team was just taken']);
    expect(await status(new UniqueViolation('picks_round_pick_number_key'))).toEqual([
      409,
      'Draft changed in another tab — refresh',
    ]);
    expect(await status(new UniqueViolation('players_league_name_ci'))).toEqual([
      409,
      "There's already a player with that name",
    ]);
    expect(await status(new UniqueViolation('rounds_league_event_key'))).toEqual([
      409,
      'That event is already in this league',
    ]);
    expect(await status(new UniqueViolation('rounds_league_season_year'))).toEqual([
      409,
      'That season has already been started — refresh',
    ]);
    expect(await status(new UniqueViolation('something_else'))).toEqual([409, 'That already exists']);
  });

  it('reports a sleeping database as 503 with the friendly message', async () => {
    const spy = vi.spyOn(console, 'error');
    const err = new DbUnavailableError('fetch failed');
    expect(await status(err)).toEqual([503, DB_ASLEEP_MESSAGE]);
    expect(spy).toHaveBeenCalledWith(err); // logged, so a paused DB is distinguishable from a missing env var
  });

  it('hides unexpected errors behind a generic 500', async () => {
    expect(await status(new Error('secret internal detail'))).toEqual([500, 'Something went wrong']);
  });
});

describe('parseBody', () => {
  const schema = z.object({
    name: z.string().trim().min(1, 'Name is required').max(5, 'Name is too long'),
  });

  it('returns the parsed value', async () => {
    const out = await parseBody(request('POST', '/x', { body: { name: ' Mom ' } }), schema);
    expect(out).toEqual({ name: 'Mom' });
  });

  it('gives a readable 400 for invalid input', async () => {
    const attempt = parseBody(request('POST', '/x', { body: { name: '' } }), schema);
    await expect(attempt).rejects.toMatchObject({ status: 400, message: 'Name is required' });
  });

  it('gives a 400 for a missing field, naming the field', async () => {
    const attempt = parseBody(request('POST', '/x', { body: {} }), schema);
    await expect(attempt).rejects.toMatchObject({ status: 400 });
    await expect(attempt).rejects.toThrow(/name/);
  });

  it('gives a 400 for a body that is not JSON', async () => {
    const attempt = parseBody(request('POST', '/x', { body: '{nope' }), schema);
    await expect(attempt).rejects.toMatchObject({ status: 400, message: 'Request body must be JSON' });
  });

  it('gives a 400 for an empty body', async () => {
    await expect(parseBody(request('POST', '/x'), schema)).rejects.toMatchObject({ status: 400 });
  });
});

describe('requireRound', () => {
  async function addRound(leagueId: string, eventKey = '2025parr') {
    return repo.createRound({
      leagueId, eventKey, eventName: 'Ramp Riot',
      startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
      scoring: defaultScoring(),
    });
  }

  it('returns a round that belongs to the league', async () => {
    const { league } = await seedLeague(repo);
    const round = await addRound(league.id);
    expect((await requireRound(league, round.id)).id).toBe(round.id);
  });

  it("answers 404 for another league's round", async () => {
    const a = await seedLeague(repo, { slug: 'league-a-aaaaaa', signIn: false });
    const b = await seedLeague(repo, { slug: 'league-b-bbbbbb', signIn: false });
    const roundB = await addRound(b.league.id);
    await expect(requireRound(a.league, roundB.id)).rejects.toMatchObject({ status: 404 });
  });

  // Review Focus 3
  it('answers 404 for an id that is not a UUID, without asking the database', async () => {
    const { league } = await seedLeague(repo);
    const spy = vi.spyOn(repo, 'getRound');
    for (const bad of ['not-a-uuid', '', '123', "'; drop table rounds; --"]) {
      await expect(requireRound(league, bad)).rejects.toMatchObject({ status: 404 });
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('answers 404 for a well-formed id that does not exist', async () => {
    const { league } = await seedLeague(repo);
    await expect(requireRound(league, '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b')).rejects.toMatchObject({ status: 404 });
  });
});

describe('isUuid', () => {
  it('accepts UUIDs in either case and rejects the rest', () => {
    expect(isUuid('3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b')).toBe(true);
    expect(isUuid('3F2B8C1E-5D4A-4E6F-9A7B-0C1D2E3F4A5B')).toBe(true);
    expect(isUuid('3f2b8c1e5d4a4e6f9a7b0c1d2e3f4a5b')).toBe(false);
    expect(isUuid('')).toBe(false);
  });
});
