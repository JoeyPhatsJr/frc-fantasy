import { readdirSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import * as eventsRoute from '@/app/api/l/[slug]/admin/events/[eventKey]/route';
import * as followsRoute from '@/app/api/l/[slug]/admin/follows/route';
import * as inviteRoute from '@/app/api/l/[slug]/admin/invite/route';
import * as leagueRoute from '@/app/api/l/[slug]/admin/league/route';
import * as playerRoute from '@/app/api/l/[slug]/admin/players/[id]/route';
import * as draftActionRoute from '@/app/api/l/[slug]/admin/rounds/[id]/draft/[action]/route';
import * as adjustmentRoute from '@/app/api/l/[slug]/admin/rounds/[id]/adjustments/[adjId]/route';
import * as adjustmentsRoute from '@/app/api/l/[slug]/admin/rounds/[id]/adjustments/route';
import * as pickRoute from '@/app/api/l/[slug]/admin/rounds/[id]/picks/[pickNumber]/route';
import * as picksRoute from '@/app/api/l/[slug]/admin/rounds/[id]/picks/route';
import * as refreshRoute from '@/app/api/l/[slug]/admin/rounds/[id]/refresh/route';
import * as resultRoute from '@/app/api/l/[slug]/admin/rounds/[id]/results/[teamKey]/route';
import * as roundRoute from '@/app/api/l/[slug]/admin/rounds/[id]/route';
import * as teamRoute from '@/app/api/l/[slug]/admin/rounds/[id]/teams/[teamKey]/route';
import * as teamsRoute from '@/app/api/l/[slug]/admin/rounds/[id]/teams/route';
import * as roundsRoute from '@/app/api/l/[slug]/admin/rounds/route';
import * as seasonsRoute from '@/app/api/l/[slug]/admin/seasons/route';
import * as stateRoute from '@/app/api/l/[slug]/admin/state/route';
import * as verifyRoute from '@/app/api/l/[slug]/admin/verify/route';
import type { Repo } from '@/lib/db/repo';
import type { AdjustmentRow, LeagueRow, PlayerRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { setUser, signInAsMember } from '../helpers/auth';
import { params, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

// Named risk 6(b): every admin handler must answer 401 signed out and 403 to anyone who isn't a
// commissioner of *this* league, and change nothing. Losing requireLeagueRole in one handler is the
// regression this file exists to catch.

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type RouteModule = Record<string, unknown>;

type Seed = { league: LeagueRow; mom: PlayerRow; round: RoundRow; adjustment: AdjustmentRow };
type Case = {
  /** Folder under app/api/l/[slug]/admin, '' for none. */
  route: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  params: (s: Seed) => Record<string, string>;
  /** A body that would succeed for a commissioner, so a missing auth check can't hide behind a 400. */
  body?: (s: Seed) => unknown;
};

const MODULES: Record<string, RouteModule> = {
  'events/[eventKey]': eventsRoute,
  follows: followsRoute,
  invite: inviteRoute,
  league: leagueRoute,
  'players/[id]': playerRoute,
  rounds: roundsRoute,
  'rounds/[id]': roundRoute,
  'rounds/[id]/adjustments': adjustmentsRoute,
  'rounds/[id]/adjustments/[adjId]': adjustmentRoute,
  'rounds/[id]/draft/[action]': draftActionRoute,
  'rounds/[id]/picks': picksRoute,
  'rounds/[id]/picks/[pickNumber]': pickRoute,
  'rounds/[id]/refresh': refreshRoute,
  'rounds/[id]/results/[teamKey]': resultRoute,
  'rounds/[id]/teams': teamsRoute,
  'rounds/[id]/teams/[teamKey]': teamRoute,
  seasons: seasonsRoute,
  state: stateRoute,
  verify: verifyRoute,
};

const slugOf = (s: Seed) => ({ slug: s.league.slug });
const roundOf = (s: Seed) => ({ slug: s.league.slug, id: s.round.id });

const CASES: Case[] = [
  { route: 'events/[eventKey]', method: 'GET', params: (s) => ({ ...slugOf(s), eventKey: '2026parr' }) },
  { route: 'follows', method: 'PUT', params: slugOf, body: () => ({ teams: [5181] }) },
  { route: 'invite', method: 'POST', params: slugOf },
  { route: 'league', method: 'PATCH', params: slugOf, body: () => ({ name: 'Hacked' }) },
  { route: 'league', method: 'DELETE', params: slugOf, body: () => ({ confirmName: 'Habich Fam' }) },
  { route: 'players/[id]', method: 'PATCH', params: (s) => ({ ...slugOf(s), id: s.mom.id }), body: () => ({ name: 'Hacked' }) },
  { route: 'players/[id]', method: 'DELETE', params: (s) => ({ ...slugOf(s), id: s.mom.id }) },
  { route: 'rounds', method: 'POST', params: slugOf, body: () => ({ eventKey: '2026parr' }) },
  { route: 'rounds/[id]', method: 'GET', params: roundOf },
  { route: 'rounds/[id]', method: 'PATCH', params: roundOf, body: () => ({ rosterSize: 3 }) },
  { route: 'rounds/[id]', method: 'DELETE', params: roundOf },
  {
    route: 'rounds/[id]/adjustments',
    method: 'POST',
    params: roundOf,
    body: (s) => ({ playerId: s.mom.id, points: 5, reason: 'Hacked' }),
  },
  {
    route: 'rounds/[id]/adjustments/[adjId]',
    method: 'PATCH',
    params: (s) => ({ ...roundOf(s), adjId: s.adjustment.id }),
    body: () => ({ points: 99 }),
  },
  { route: 'rounds/[id]/adjustments/[adjId]', method: 'DELETE', params: (s) => ({ ...roundOf(s), adjId: s.adjustment.id }) },
  { route: 'rounds/[id]/draft/[action]', method: 'POST', params: (s) => ({ ...roundOf(s), action: 'start' }) },
  { route: 'rounds/[id]/picks', method: 'POST', params: roundOf, body: () => ({ expectedPickNumber: 1, teamKey: 'frc254' }) },
  { route: 'rounds/[id]/picks/[pickNumber]', method: 'PATCH', params: (s) => ({ ...roundOf(s), pickNumber: '0' }), body: () => ({ teamKey: 'frc254' }) },
  { route: 'rounds/[id]/picks/[pickNumber]', method: 'DELETE', params: (s) => ({ ...roundOf(s), pickNumber: '0' }) },
  { route: 'rounds/[id]/refresh', method: 'POST', params: roundOf },
  // The seeded round is a TBA round, so a commissioner gets 409 here. That still isn't 401/403,
  // so a handler that lost its role check would fail this matrix.
  { route: 'rounds/[id]/results/[teamKey]', method: 'PUT', params: (s) => ({ ...roundOf(s), teamKey: 'frc341' }), body: () => ({ qualWins: 1 }) },
  { route: 'rounds/[id]/results/[teamKey]', method: 'DELETE', params: (s) => ({ ...roundOf(s), teamKey: 'frc341' }) },
  { route: 'rounds/[id]/teams', method: 'POST', params: roundOf, body: () => ({ teamNumber: '254' }) },
  { route: 'rounds/[id]/teams/[teamKey]', method: 'DELETE', params: (s) => ({ ...roundOf(s), teamKey: 'frc9999' }) },
  // The seeded league is an event league, so a commissioner gets 409 here; still not 401/403.
  { route: 'seasons', method: 'POST', params: slugOf },
  { route: 'state', method: 'GET', params: slugOf },
  { route: 'verify', method: 'GET', params: slugOf },
];

const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const ADMIN_DIR = join(process.cwd(), 'app', 'api', 'l', '[slug]', 'admin');

/** Every route.ts under the admin folder, as its folder relative to the admin folder ('' for the root). */
function adminRouteFolders(): string[] {
  return (readdirSync(ADMIN_DIR, { recursive: true }) as string[])
    .filter((p) => p === 'route.ts' || p.endsWith(`${sep}route.ts`))
    .map((p) => (dirname(p) === '.' ? '' : dirname(p).split(sep).join('/')))
    .sort();
}

const MUTATING = /^(create|update|delete|insert|rename|reset|add|remove|upsert|set)/;

let repo: Repo;
let writes: string[];
let seed: Seed;

beforeEach(async () => {
  setUser(null);
  writes = [];
  const real = createMemoryRepo();
  repo = new Proxy(real, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop === 'string' && typeof value === 'function' && MUTATING.test(prop)) {
        return (...args: unknown[]) => {
          writes.push(prop);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return value;
    },
  });
  h.repo = repo;
  h.getTba = vi.fn(async () => {
    throw new Error('TBA must not be called before the role check');
  });

  const { league, commissioner } = await seedLeague(real);
  const mom = await real.createPlayer(league.id, 'Mom');
  let round = await real.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
  });
  round = await real.updateRound(round.id, { draftOrder: [commissioner.id, mom.id], rosterSize: 2 });
  await real.insertPick({ roundId: round.id, pickNumber: 0, playerId: commissioner.id, teamKey: 'frc341' });
  await real.addExtraTeam(round.id, 'frc9999');
  const adjustment = await real.insertAdjustment({ roundId: round.id, playerId: mom.id, teamKey: null, points: 1, reason: 'Spirit' });
  seed = { league, mom, round, adjustment };
  setUser(null);
});

function handlerFor(c: Case): Handler {
  const fn = MODULES[c.route]?.[c.method];
  if (typeof fn !== 'function') throw new Error(`No ${c.method} export in admin/${c.route}`);
  return fn as Handler;
}

async function attempt(c: Case): Promise<Response> {
  const body = c.body?.(seed);
  return handlerFor(c)(request(c.method, `/api/l/${seed.league.slug}/admin/${c.route}`, { body }), params(c.params(seed)));
}

describe('admin auth matrix: the table covers every admin route', () => {
  it('has a MODULES entry for every route.ts under app/api/l/[slug]/admin', () => {
    expect(adminRouteFolders()).toEqual(Object.keys(MODULES).sort());
  });

  it('has a CASES row for every exported HTTP handler, and no row without a handler', () => {
    const exported = Object.entries(MODULES)
      .flatMap(([route, mod]) =>
        Object.keys(mod)
          .filter((k) => HTTP_METHODS.includes(k) && typeof mod[k] === 'function')
          .map((method) => `${method} ${route}`),
      )
      .sort();
    expect(CASES.map((c) => `${c.method} ${c.route}`).sort()).toEqual(exported);
  });
});

describe.each(CASES)('$method admin/$route', (c) => {
  it('answers 401 when signed out, and changes nothing', async () => {
    const res = await attempt(c);
    expect(res.status).toBe(401);
    expect(writes).toEqual([]);
    expect(h.getTba).not.toHaveBeenCalled();
  });

  it('answers 403 to a signed-in member who is not a commissioner, and changes nothing', async () => {
    await signInAsMember(repo, seed.league, 'Dad', 'player');
    writes = [];
    const res = await attempt(c);
    expect(res.status).toBe(403);
    expect(writes).toEqual([]);
    expect(h.getTba).not.toHaveBeenCalled();
  });

  it("answers 403 to another league's commissioner, and changes nothing", async () => {
    await seedLeague(repo, { name: 'Other Fam', slug: 'other-fam-bbbbbb' }); // signs in as its commissioner
    writes = [];
    const res = await attempt(c);
    expect(res.status).toBe(403);
    expect(writes).toEqual([]);
    expect(h.getTba).not.toHaveBeenCalled();
  });
});
