# FRC Fantasy v1 — Part 2: Database, TBA Client, Auth, API (Tasks 12–21)

> Part of `2026-09-29-frc-fantasy-v1.md`. Read that file first: its **Global Constraints**, **Deviations**, and **Review Focus** apply to every task here. Part 1 must be finished.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Spec:** `docs/superpowers/specs/2026-09-29-frc-fantasy-design.md`

Every commit message ends with a blank line and then:
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`

## How Part 2 is tested

Route handlers never talk to Supabase directly. They call `getRepo()` and get back something that implements the `Repo` interface. In production that is the Supabase implementation. In tests, `vi.mock('@/lib/db')` swaps in an **in-memory** implementation that enforces the same unique constraints and throws the same `UniqueViolation` errors. The same trick replaces `getTba` so tests never call The Blue Alliance.

Every API test file starts with this exact block (repeated in each task so tasks can be read on their own):

```ts
const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));
```

`vi.hoisted` is needed because Vitest moves `vi.mock` calls to the top of the file, above the imports, so anything they refer to has to be created in a hoisted block too.

---

### Task 12: Database schema and the `Repo` layer

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Create: `lib/db/types.ts`, `lib/db/repo.ts`, `lib/db/supabaseRepo.ts`, `lib/db/index.ts`
- Create: `tests/helpers/memoryRepo.ts`
- Create: `scripts/db-smoke.ts`
- Test: `tests/db/memoryRepo.test.ts`

**Interfaces:**
- Consumes: `ScoringConfig`, `defaultScoring` from `@/lib/scoring/config`.
- Produces:
  - Row types from `@/lib/db/types`: `LeagueRow`, `PlayerRow`, `RoundRow`, `PickRow`, `AdjustmentRow`, `CacheRow` (all camelCase; timestamps and dates are strings)
  - From `@/lib/db/repo`: `interface Repo` (full listing in Step 2), `class UniqueViolation { constraint: string }`, `class DbUnavailableError`, input types `NewLeague`, `LeaguePatch`, `NewRound`, `RoundPatch`, `NewPick`, `NewAdjustment`, `AdjustmentPatch`
  - From `@/lib/db`: `getRepo(): Repo`
  - From `tests/helpers/memoryRepo.ts`: `createMemoryRepo(): Repo`
  - Constraint names used for 409 mapping: `picks_round_team_key`, `picks_round_pick_number_key`, `players_league_name_ci`, `rounds_league_event_key`, `leagues_slug_key`

- [ ] **Step 1: Write the migration**

`supabase/migrations/0001_init.sql` (spec §6.1, plus RLS from §6.3; the only change from the spec's SQL is that the rounds unique constraint gets an explicit name so the API can map it to a message):

```sql
create table leagues (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null,
  name              text not null check (char_length(name) between 1 and 80),
  admin_token_hash  text not null,
  home_team_number  integer not null default 5181,
  default_scoring   jsonb not null,
  created_at        timestamptz not null default now(),
  constraint leagues_slug_key unique (slug)
);

create table players (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references leagues(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  created_at  timestamptz not null default now()
);
create unique index players_league_name_ci on players (league_id, lower(name));

create table rounds (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references leagues(id) on delete cascade,
  event_key     text not null check (event_key ~ '^[0-9]{4}[a-z0-9]+$'),
  event_name    text not null,
  start_date    date not null,
  end_date      date not null,
  timezone      text not null default 'America/New_York',
  roster_size   integer not null default 4 check (roster_size between 1 and 10),
  draft_order   uuid[] not null default '{}',
  scoring       jsonb not null,
  finalized_at  timestamptz,
  created_at    timestamptz not null default now(),
  constraint rounds_league_event_key unique (league_id, event_key)
);

create table round_extra_teams (
  round_id  uuid not null references rounds(id) on delete cascade,
  team_key  text not null check (team_key ~ '^frc[1-9][0-9]{0,4}[A-Z]?$'),
  primary key (round_id, team_key)
);

create table picks (
  id           uuid primary key default gen_random_uuid(),
  round_id     uuid not null references rounds(id) on delete cascade,
  pick_number  integer not null check (pick_number >= 0),
  player_id    uuid not null references players(id) on delete cascade,
  team_key     text not null check (team_key ~ '^frc[1-9][0-9]{0,4}[A-Z]?$'),
  created_at   timestamptz not null default now(),
  constraint picks_round_pick_number_key unique (round_id, pick_number),
  constraint picks_round_team_key unique (round_id, team_key)
);

create table adjustments (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references rounds(id) on delete cascade,
  player_id   uuid references players(id) on delete cascade,
  team_key    text check (team_key ~ '^frc[1-9][0-9]{0,4}[A-Z]?$'),
  points      integer not null check (points between -1000 and 1000),
  reason      text not null check (char_length(reason) between 1 and 200),
  created_at  timestamptz not null default now(),
  check ((player_id is null) <> (team_key is null))
);

create table tba_cache (
  path          text primary key,
  etag          text,
  body          jsonb,
  fetched_at    timestamptz not null,
  last_error    text,
  last_error_at timestamptz
);

create index players_league_idx on players (league_id);
create index rounds_league_idx on rounds (league_id);
create index picks_round_idx on picks (round_id);
create index adjustments_round_idx on adjustments (round_id);

-- RLS on, no policies: the anon key can read and write nothing (spec §6.3).
-- The server uses the service role key, which bypasses RLS.
alter table leagues            enable row level security;
alter table players            enable row level security;
alter table rounds             enable row level security;
alter table round_extra_teams  enable row level security;
alter table picks              enable row level security;
alter table adjustments        enable row level security;
alter table tba_cache          enable row level security;
```

- [ ] **Step 2: Write the row types and the `Repo` interface**

`lib/db/types.ts`:

```ts
import type { ScoringConfig } from '@/lib/scoring/config';

export type LeagueRow = {
  id: string;
  slug: string;
  name: string;
  adminTokenHash: string;
  homeTeamNumber: number;
  defaultScoring: ScoringConfig;
  createdAt: string;
};

export type PlayerRow = { id: string; leagueId: string; name: string; createdAt: string };

export type RoundRow = {
  id: string;
  leagueId: string;
  eventKey: string;
  eventName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  timezone: string;
  rosterSize: number;
  draftOrder: string[];
  scoring: ScoringConfig;
  finalizedAt: string | null;
  createdAt: string;
};

export type PickRow = {
  id: string;
  roundId: string;
  pickNumber: number;
  playerId: string;
  teamKey: string;
  createdAt: string;
};

export type AdjustmentRow = {
  id: string;
  roundId: string;
  playerId: string | null;
  teamKey: string | null;
  points: number;
  reason: string;
  createdAt: string;
};

export type CacheRow = {
  path: string;
  etag: string | null;
  /** null = TBA had no data (JSON null or 404). */
  body: unknown | null;
  fetchedAt: string;
  lastError: string | null;
  lastErrorAt: string | null;
};
```

`lib/db/repo.ts`:

```ts
import type {
  AdjustmentRow,
  CacheRow,
  LeagueRow,
  PickRow,
  PlayerRow,
  RoundRow,
} from '@/lib/db/types';
import type { ScoringConfig } from '@/lib/scoring/config';

/** Thrown when an insert or update breaks a unique constraint. `constraint` is the Postgres name. */
export class UniqueViolation extends Error {
  constructor(public readonly constraint: string) {
    super(`Unique constraint violated: ${constraint}`);
    this.name = 'UniqueViolation';
  }
}

/** Thrown when the database can't be reached (for example, a paused Supabase project). */
export class DbUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbUnavailableError';
  }
}

export type NewLeague = {
  slug: string;
  name: string;
  adminTokenHash: string;
  defaultScoring: ScoringConfig;
};
export type LeaguePatch = {
  name?: string;
  homeTeamNumber?: number;
  defaultScoring?: ScoringConfig;
  adminTokenHash?: string;
};
export type NewRound = {
  leagueId: string;
  eventKey: string;
  eventName: string;
  startDate: string;
  endDate: string;
  timezone: string;
  scoring: ScoringConfig;
};
export type RoundPatch = {
  rosterSize?: number;
  draftOrder?: string[];
  scoring?: ScoringConfig;
  finalizedAt?: string | null;
};
export type NewPick = { roundId: string; pickNumber: number; playerId: string; teamKey: string };
export type NewAdjustment = {
  roundId: string;
  playerId: string | null;
  teamKey: string | null;
  points: number;
  reason: string;
};
export type AdjustmentPatch = {
  playerId?: string | null;
  teamKey?: string | null;
  points?: number;
  reason?: string;
};

export interface Repo {
  createLeague(input: NewLeague): Promise<LeagueRow>;
  getLeagueBySlug(slug: string): Promise<LeagueRow | null>;
  updateLeague(id: string, patch: LeaguePatch): Promise<LeagueRow>;
  deleteLeague(id: string): Promise<void>;

  listPlayers(leagueId: string): Promise<PlayerRow[]>; // oldest first
  createPlayer(leagueId: string, name: string): Promise<PlayerRow>;
  renamePlayer(id: string, name: string): Promise<PlayerRow>;
  deletePlayer(id: string): Promise<void>;

  listRounds(leagueId: string): Promise<RoundRow[]>; // by start date, then creation time
  getRound(id: string): Promise<RoundRow | null>;
  createRound(input: NewRound): Promise<RoundRow>;
  updateRound(id: string, patch: RoundPatch): Promise<RoundRow>;
  deleteRound(id: string): Promise<void>;

  listExtraTeams(roundId: string): Promise<string[]>;
  addExtraTeam(roundId: string, teamKey: string): Promise<void>; // adding twice is fine
  removeExtraTeam(roundId: string, teamKey: string): Promise<void>;

  listPicks(roundId: string): Promise<PickRow[]>; // by pick number
  listPicksForRounds(roundIds: string[]): Promise<PickRow[]>;
  insertPick(input: NewPick): Promise<PickRow>;
  deletePick(roundId: string, pickNumber: number): Promise<void>;
  updatePickTeam(roundId: string, pickNumber: number, teamKey: string): Promise<PickRow>;

  listAdjustments(roundId: string): Promise<AdjustmentRow[]>; // oldest first
  listAdjustmentsForRounds(roundIds: string[]): Promise<AdjustmentRow[]>;
  getAdjustment(id: string): Promise<AdjustmentRow | null>;
  insertAdjustment(input: NewAdjustment): Promise<AdjustmentRow>;
  updateAdjustment(id: string, patch: AdjustmentPatch): Promise<AdjustmentRow>;
  deleteAdjustment(id: string): Promise<void>;

  getCache(path: string): Promise<CacheRow | null>;
  upsertCache(row: CacheRow): Promise<void>;
}
```

- [ ] **Step 3: Write the failing test for the in-memory repo**

`tests/db/memoryRepo.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { UniqueViolation, type Repo } from '@/lib/db/repo';
import { defaultScoring } from '@/lib/scoring/config';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;

async function seed() {
  const league = await repo.createLeague({
    slug: 'fam-abc234',
    name: 'Fam',
    adminTokenHash: 'hash',
    defaultScoring: defaultScoring(),
  });
  const mom = await repo.createPlayer(league.id, 'Mom');
  const round = await repo.createRound({
    leagueId: league.id,
    eventKey: '2025parr',
    eventName: 'Ramp Riot',
    startDate: '2025-10-25',
    endDate: '2025-10-25',
    timezone: 'America/New_York',
    scoring: defaultScoring(),
  });
  return { league, mom, round };
}

async function violation(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof UniqueViolation) return err.constraint;
    throw err;
  }
  throw new Error('expected a UniqueViolation');
}

beforeEach(() => {
  repo = createMemoryRepo();
});

describe('memory repo', () => {
  it('creates and finds a league with defaults filled in', async () => {
    const { league } = await seed();
    expect(league.homeTeamNumber).toBe(5181);
    expect((await repo.getLeagueBySlug('fam-abc234'))?.id).toBe(league.id);
    expect(await repo.getLeagueBySlug('nope')).toBeNull();
  });

  it('rejects a duplicate slug', async () => {
    await seed();
    const dup = repo.createLeague({ slug: 'fam-abc234', name: 'x', adminTokenHash: 'h', defaultScoring: defaultScoring() });
    expect(await violation(dup)).toBe('leagues_slug_key');
  });

  it('rejects player names that differ only by case, on create and rename', async () => {
    const { league } = await seed();
    expect(await violation(repo.createPlayer(league.id, 'mom'))).toBe('players_league_name_ci');
    const dad = await repo.createPlayer(league.id, 'Dad');
    expect(await violation(repo.renamePlayer(dad.id, 'MOM'))).toBe('players_league_name_ci');
    expect((await repo.renamePlayer(dad.id, 'dad')).name).toBe('dad'); // renaming to own name is fine
  });

  it('creates rounds with the schema defaults', async () => {
    const { round } = await seed();
    expect(round).toMatchObject({ rosterSize: 4, draftOrder: [], finalizedAt: null });
  });

  it('rejects the same event twice in one league', async () => {
    const { league } = await seed();
    const dup = repo.createRound({
      leagueId: league.id, eventKey: '2025parr', eventName: 'x',
      startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    expect(await violation(dup)).toBe('rounds_league_event_key');
  });

  it('enforces one owner per team and one pick per pick number', async () => {
    const { round, mom } = await seed();
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc341' });
    expect(
      await violation(repo.insertPick({ roundId: round.id, pickNumber: 1, playerId: mom.id, teamKey: 'frc341' })),
    ).toBe('picks_round_team_key');
    expect(
      await violation(repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc25' })),
    ).toBe('picks_round_pick_number_key');
  });

  it('rejects replacing a pick with a team that is already taken', async () => {
    const { round, mom } = await seed();
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc341' });
    await repo.insertPick({ roundId: round.id, pickNumber: 1, playerId: mom.id, teamKey: 'frc25' });
    expect(await violation(repo.updatePickTeam(round.id, 1, 'frc341'))).toBe('picks_round_team_key');
    expect((await repo.updatePickTeam(round.id, 1, 'frc1')).teamKey).toBe('frc1');
  });

  it('lists picks in pick order', async () => {
    const { round, mom } = await seed();
    await repo.insertPick({ roundId: round.id, pickNumber: 1, playerId: mom.id, teamKey: 'frc25' });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc341' });
    expect((await repo.listPicks(round.id)).map((p) => p.pickNumber)).toEqual([0, 1]);
  });

  it('deleting a round removes its picks, adjustments, and extra teams', async () => {
    const { round, mom } = await seed();
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc341' });
    await repo.insertAdjustment({ roundId: round.id, playerId: mom.id, teamKey: null, points: 5, reason: 'x' });
    await repo.addExtraTeam(round.id, 'frc9999');
    await repo.deleteRound(round.id);
    expect(await repo.getRound(round.id)).toBeNull();
    expect(await repo.listPicks(round.id)).toEqual([]);
    expect(await repo.listAdjustments(round.id)).toEqual([]);
    expect(await repo.listExtraTeams(round.id)).toEqual([]);
  });

  it('adding the same extra team twice keeps one copy', async () => {
    const { round } = await seed();
    await repo.addExtraTeam(round.id, 'frc9999');
    await repo.addExtraTeam(round.id, 'frc9999');
    expect(await repo.listExtraTeams(round.id)).toEqual(['frc9999']);
  });

  it('returns copies, so callers cannot change stored rows by accident', async () => {
    const { round } = await seed();
    const fetched = (await repo.getRound(round.id))!;
    fetched.draftOrder.push('x');
    expect((await repo.getRound(round.id))!.draftOrder).toEqual([]);
  });

  it('stores and replaces cache rows', async () => {
    const row = { path: '/event/x', etag: 'a', body: { n: 1 }, fetchedAt: '2026-01-01T00:00:00.000Z', lastError: null, lastErrorAt: null };
    await repo.upsertCache(row);
    await repo.upsertCache({ ...row, etag: 'b', body: null });
    expect(await repo.getCache('/event/x')).toEqual({ ...row, etag: 'b', body: null });
    expect(await repo.getCache('/other')).toBeNull();
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run tests/db/memoryRepo.test.ts`
Expected: FAIL, cannot resolve `../helpers/memoryRepo`.

- [ ] **Step 5: Implement the in-memory repo**

`tests/helpers/memoryRepo.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { UniqueViolation, type Repo } from '@/lib/db/repo';
import type {
  AdjustmentRow,
  CacheRow,
  LeagueRow,
  PickRow,
  PlayerRow,
  RoundRow,
} from '@/lib/db/types';

/** A Repo that lives in memory and enforces the same unique constraints as the real schema. */
export function createMemoryRepo(): Repo {
  let leagues: LeagueRow[] = [];
  let players: PlayerRow[] = [];
  let rounds: RoundRow[] = [];
  let extraTeams: { roundId: string; teamKey: string }[] = [];
  let picks: PickRow[] = [];
  let adjustments: AdjustmentRow[] = [];
  const cache = new Map<string, CacheRow>();

  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 0, 1) + tick++ * 1000).toISOString();
  const copy = <T>(v: T): T => structuredClone(v);
  /** Like the real database: a patch only touches the fields it actually names. */
  const defined = <T extends object>(patch: T): Partial<T> =>
    Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;

  function find<T extends { id: string }>(rows: T[], id: string, what: string): T {
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error(`${what} ${id} not found`);
    return row;
  }

  function dropRounds(ids: string[]) {
    rounds = rounds.filter((r) => !ids.includes(r.id));
    picks = picks.filter((p) => !ids.includes(p.roundId));
    adjustments = adjustments.filter((a) => !ids.includes(a.roundId));
    extraTeams = extraTeams.filter((t) => !ids.includes(t.roundId));
  }

  return {
    async createLeague(input) {
      if (leagues.some((l) => l.slug === input.slug)) throw new UniqueViolation('leagues_slug_key');
      const row: LeagueRow = { id: randomUUID(), homeTeamNumber: 5181, createdAt: stamp(), ...copy(input) };
      leagues.push(row);
      return copy(row);
    },
    async getLeagueBySlug(slug) {
      return copy(leagues.find((l) => l.slug === slug) ?? null);
    },
    async updateLeague(id, patch) {
      const row = find(leagues, id, 'league');
      Object.assign(row, defined(copy(patch)));
      return copy(row);
    },
    async deleteLeague(id) {
      dropRounds(rounds.filter((r) => r.leagueId === id).map((r) => r.id));
      players = players.filter((p) => p.leagueId !== id);
      leagues = leagues.filter((l) => l.id !== id);
    },

    async listPlayers(leagueId) {
      return copy(players.filter((p) => p.leagueId === leagueId));
    },
    async createPlayer(leagueId, name) {
      if (players.some((p) => p.leagueId === leagueId && p.name.toLowerCase() === name.toLowerCase())) {
        throw new UniqueViolation('players_league_name_ci');
      }
      const row: PlayerRow = { id: randomUUID(), leagueId, name, createdAt: stamp() };
      players.push(row);
      return copy(row);
    },
    async renamePlayer(id, name) {
      const row = find(players, id, 'player');
      const clash = players.some(
        (p) => p.id !== id && p.leagueId === row.leagueId && p.name.toLowerCase() === name.toLowerCase(),
      );
      if (clash) throw new UniqueViolation('players_league_name_ci');
      row.name = name;
      return copy(row);
    },
    async deletePlayer(id) {
      players = players.filter((p) => p.id !== id);
      picks = picks.filter((p) => p.playerId !== id);
      adjustments = adjustments.filter((a) => a.playerId !== id);
    },

    async listRounds(leagueId) {
      return copy(
        rounds
          .filter((r) => r.leagueId === leagueId)
          .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.createdAt.localeCompare(b.createdAt)),
      );
    },
    async getRound(id) {
      return copy(rounds.find((r) => r.id === id) ?? null);
    },
    async createRound(input) {
      if (rounds.some((r) => r.leagueId === input.leagueId && r.eventKey === input.eventKey)) {
        throw new UniqueViolation('rounds_league_event_key');
      }
      const row: RoundRow = {
        id: randomUUID(),
        rosterSize: 4,
        draftOrder: [],
        finalizedAt: null,
        createdAt: stamp(),
        ...copy(input),
      };
      rounds.push(row);
      return copy(row);
    },
    async updateRound(id, patch) {
      const row = find(rounds, id, 'round');
      Object.assign(row, defined(copy(patch)));
      return copy(row);
    },
    async deleteRound(id) {
      dropRounds([id]);
    },

    async listExtraTeams(roundId) {
      return extraTeams.filter((t) => t.roundId === roundId).map((t) => t.teamKey);
    },
    async addExtraTeam(roundId, teamKey) {
      if (!extraTeams.some((t) => t.roundId === roundId && t.teamKey === teamKey)) {
        extraTeams.push({ roundId, teamKey });
      }
    },
    async removeExtraTeam(roundId, teamKey) {
      extraTeams = extraTeams.filter((t) => !(t.roundId === roundId && t.teamKey === teamKey));
    },

    async listPicks(roundId) {
      return copy(picks.filter((p) => p.roundId === roundId).sort((a, b) => a.pickNumber - b.pickNumber));
    },
    async listPicksForRounds(roundIds) {
      return copy(
        picks.filter((p) => roundIds.includes(p.roundId)).sort((a, b) => a.pickNumber - b.pickNumber),
      );
    },
    async insertPick(input) {
      const inRound = picks.filter((p) => p.roundId === input.roundId);
      if (inRound.some((p) => p.pickNumber === input.pickNumber)) {
        throw new UniqueViolation('picks_round_pick_number_key');
      }
      if (inRound.some((p) => p.teamKey === input.teamKey)) throw new UniqueViolation('picks_round_team_key');
      const row: PickRow = { id: randomUUID(), createdAt: stamp(), ...input };
      picks.push(row);
      return copy(row);
    },
    async deletePick(roundId, pickNumber) {
      picks = picks.filter((p) => !(p.roundId === roundId && p.pickNumber === pickNumber));
    },
    async updatePickTeam(roundId, pickNumber, teamKey) {
      const row = picks.find((p) => p.roundId === roundId && p.pickNumber === pickNumber);
      if (!row) throw new Error(`pick ${pickNumber} not found`);
      const taken = picks.some((p) => p.roundId === roundId && p.id !== row.id && p.teamKey === teamKey);
      if (taken) throw new UniqueViolation('picks_round_team_key');
      row.teamKey = teamKey;
      return copy(row);
    },

    async listAdjustments(roundId) {
      return copy(adjustments.filter((a) => a.roundId === roundId));
    },
    async listAdjustmentsForRounds(roundIds) {
      return copy(adjustments.filter((a) => roundIds.includes(a.roundId)));
    },
    async getAdjustment(id) {
      return copy(adjustments.find((a) => a.id === id) ?? null);
    },
    async insertAdjustment(input) {
      const row: AdjustmentRow = { id: randomUUID(), createdAt: stamp(), ...input };
      adjustments.push(row);
      return copy(row);
    },
    async updateAdjustment(id, patch) {
      const row = find(adjustments, id, 'adjustment');
      Object.assign(row, defined(patch));
      return copy(row);
    },
    async deleteAdjustment(id) {
      adjustments = adjustments.filter((a) => a.id !== id);
    },

    async getCache(path) {
      return copy(cache.get(path) ?? null);
    },
    async upsertCache(row) {
      cache.set(row.path, copy(row));
    },
  };
}
```

- [ ] **Step 6: Run it and watch it pass**

Run: `npx vitest run tests/db/memoryRepo.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the Supabase implementation**

`lib/db/supabaseRepo.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DbUnavailableError, UniqueViolation, type Repo } from '@/lib/db/repo';
import type {
  AdjustmentRow,
  CacheRow,
  LeagueRow,
  PickRow,
  PlayerRow,
  RoundRow,
} from '@/lib/db/types';

// Database rows arrive in snake_case. These mappers are the only place that knows that.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

const toLeague = (r: Raw): LeagueRow => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  adminTokenHash: r.admin_token_hash,
  homeTeamNumber: r.home_team_number,
  defaultScoring: r.default_scoring,
  createdAt: r.created_at,
});
const toPlayer = (r: Raw): PlayerRow => ({
  id: r.id,
  leagueId: r.league_id,
  name: r.name,
  createdAt: r.created_at,
});
const toRound = (r: Raw): RoundRow => ({
  id: r.id,
  leagueId: r.league_id,
  eventKey: r.event_key,
  eventName: r.event_name,
  startDate: r.start_date,
  endDate: r.end_date,
  timezone: r.timezone,
  rosterSize: r.roster_size,
  draftOrder: r.draft_order ?? [],
  scoring: r.scoring,
  finalizedAt: r.finalized_at,
  createdAt: r.created_at,
});
const toPick = (r: Raw): PickRow => ({
  id: r.id,
  roundId: r.round_id,
  pickNumber: r.pick_number,
  playerId: r.player_id,
  teamKey: r.team_key,
  createdAt: r.created_at,
});
const toAdjustment = (r: Raw): AdjustmentRow => ({
  id: r.id,
  roundId: r.round_id,
  playerId: r.player_id,
  teamKey: r.team_key,
  points: r.points,
  reason: r.reason,
  createdAt: r.created_at,
});
const toCache = (r: Raw): CacheRow => ({
  path: r.path,
  etag: r.etag,
  body: r.body,
  fetchedAt: r.fetched_at,
  lastError: r.last_error,
  lastErrorAt: r.last_error_at,
});

/** Drops keys whose value is undefined, so a patch only touches the columns it names. */
function defined(obj: Raw): Raw {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

type Result = { data: unknown; error: { code?: string; message: string } | null };

async function run(query: PromiseLike<Result>): Promise<Raw[]> {
  let res: Result;
  try {
    res = await query;
  } catch (err) {
    throw new DbUnavailableError(err instanceof Error ? err.message : String(err));
  }
  if (res.error) {
    if (res.error.code === '23505') {
      const m = /unique constraint "([^"]+)"/.exec(res.error.message);
      throw new UniqueViolation(m?.[1] ?? 'unknown');
    }
    // No Postgres/PostgREST code means the request never reached the database.
    if (!res.error.code) throw new DbUnavailableError(res.error.message);
    throw new Error(`Database error ${res.error.code}: ${res.error.message}`);
  }
  if (res.data === null || res.data === undefined) return [];
  return Array.isArray(res.data) ? (res.data as Raw[]) : [res.data as Raw];
}

function first<T>(rows: Raw[], map: (r: Raw) => T, what: string): T {
  if (rows.length === 0) throw new Error(`${what} not found`);
  return map(rows[0]);
}

export function createSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new DbUnavailableError('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Spec §9.2: Next.js must never cache database reads.
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
}

export function createSupabaseRepo(db: SupabaseClient): Repo {
  return {
    async createLeague(input) {
      const rows = await run(
        db
          .from('leagues')
          .insert({
            slug: input.slug,
            name: input.name,
            admin_token_hash: input.adminTokenHash,
            default_scoring: input.defaultScoring,
          })
          .select(),
      );
      return first(rows, toLeague, 'league');
    },
    async getLeagueBySlug(slug) {
      const rows = await run(db.from('leagues').select().eq('slug', slug).limit(1));
      return rows[0] ? toLeague(rows[0]) : null;
    },
    async updateLeague(id, patch) {
      const rows = await run(
        db
          .from('leagues')
          .update(
            defined({
              name: patch.name,
              home_team_number: patch.homeTeamNumber,
              default_scoring: patch.defaultScoring,
              admin_token_hash: patch.adminTokenHash,
            }),
          )
          .eq('id', id)
          .select(),
      );
      return first(rows, toLeague, 'league');
    },
    async deleteLeague(id) {
      await run(db.from('leagues').delete().eq('id', id));
    },

    async listPlayers(leagueId) {
      const rows = await run(db.from('players').select().eq('league_id', leagueId).order('created_at'));
      return rows.map(toPlayer);
    },
    async createPlayer(leagueId, name) {
      const rows = await run(db.from('players').insert({ league_id: leagueId, name }).select());
      return first(rows, toPlayer, 'player');
    },
    async renamePlayer(id, name) {
      const rows = await run(db.from('players').update({ name }).eq('id', id).select());
      return first(rows, toPlayer, 'player');
    },
    async deletePlayer(id) {
      await run(db.from('players').delete().eq('id', id));
    },

    async listRounds(leagueId) {
      const rows = await run(
        db.from('rounds').select().eq('league_id', leagueId).order('start_date').order('created_at'),
      );
      return rows.map(toRound);
    },
    async getRound(id) {
      const rows = await run(db.from('rounds').select().eq('id', id).limit(1));
      return rows[0] ? toRound(rows[0]) : null;
    },
    async createRound(input) {
      const rows = await run(
        db
          .from('rounds')
          .insert({
            league_id: input.leagueId,
            event_key: input.eventKey,
            event_name: input.eventName,
            start_date: input.startDate,
            end_date: input.endDate,
            timezone: input.timezone,
            scoring: input.scoring,
          })
          .select(),
      );
      return first(rows, toRound, 'round');
    },
    async updateRound(id, patch) {
      const rows = await run(
        db
          .from('rounds')
          .update(
            defined({
              roster_size: patch.rosterSize,
              draft_order: patch.draftOrder,
              scoring: patch.scoring,
              finalized_at: patch.finalizedAt,
            }),
          )
          .eq('id', id)
          .select(),
      );
      return first(rows, toRound, 'round');
    },
    async deleteRound(id) {
      await run(db.from('rounds').delete().eq('id', id));
    },

    async listExtraTeams(roundId) {
      const rows = await run(db.from('round_extra_teams').select().eq('round_id', roundId));
      return rows.map((r) => r.team_key as string);
    },
    async addExtraTeam(roundId, teamKey) {
      await run(
        db
          .from('round_extra_teams')
          .upsert({ round_id: roundId, team_key: teamKey }, { onConflict: 'round_id,team_key' }),
      );
    },
    async removeExtraTeam(roundId, teamKey) {
      await run(db.from('round_extra_teams').delete().eq('round_id', roundId).eq('team_key', teamKey));
    },

    async listPicks(roundId) {
      const rows = await run(db.from('picks').select().eq('round_id', roundId).order('pick_number'));
      return rows.map(toPick);
    },
    async listPicksForRounds(roundIds) {
      if (roundIds.length === 0) return [];
      const rows = await run(db.from('picks').select().in('round_id', roundIds).order('pick_number'));
      return rows.map(toPick);
    },
    async insertPick(input) {
      const rows = await run(
        db
          .from('picks')
          .insert({
            round_id: input.roundId,
            pick_number: input.pickNumber,
            player_id: input.playerId,
            team_key: input.teamKey,
          })
          .select(),
      );
      return first(rows, toPick, 'pick');
    },
    async deletePick(roundId, pickNumber) {
      await run(db.from('picks').delete().eq('round_id', roundId).eq('pick_number', pickNumber));
    },
    async updatePickTeam(roundId, pickNumber, teamKey) {
      const rows = await run(
        db
          .from('picks')
          .update({ team_key: teamKey })
          .eq('round_id', roundId)
          .eq('pick_number', pickNumber)
          .select(),
      );
      return first(rows, toPick, 'pick');
    },

    async listAdjustments(roundId) {
      const rows = await run(db.from('adjustments').select().eq('round_id', roundId).order('created_at'));
      return rows.map(toAdjustment);
    },
    async listAdjustmentsForRounds(roundIds) {
      if (roundIds.length === 0) return [];
      const rows = await run(
        db.from('adjustments').select().in('round_id', roundIds).order('created_at'),
      );
      return rows.map(toAdjustment);
    },
    async getAdjustment(id) {
      const rows = await run(db.from('adjustments').select().eq('id', id).limit(1));
      return rows[0] ? toAdjustment(rows[0]) : null;
    },
    async insertAdjustment(input) {
      const rows = await run(
        db
          .from('adjustments')
          .insert({
            round_id: input.roundId,
            player_id: input.playerId,
            team_key: input.teamKey,
            points: input.points,
            reason: input.reason,
          })
          .select(),
      );
      return first(rows, toAdjustment, 'adjustment');
    },
    async updateAdjustment(id, patch) {
      const rows = await run(
        db
          .from('adjustments')
          .update(
            defined({
              player_id: patch.playerId,
              team_key: patch.teamKey,
              points: patch.points,
              reason: patch.reason,
            }),
          )
          .eq('id', id)
          .select(),
      );
      return first(rows, toAdjustment, 'adjustment');
    },
    async deleteAdjustment(id) {
      await run(db.from('adjustments').delete().eq('id', id));
    },

    async getCache(path) {
      const rows = await run(db.from('tba_cache').select().eq('path', path).limit(1));
      return rows[0] ? toCache(rows[0]) : null;
    },
    async upsertCache(row) {
      await run(
        db.from('tba_cache').upsert(
          {
            path: row.path,
            etag: row.etag,
            body: row.body, // JS null is stored as SQL NULL
            fetched_at: row.fetchedAt,
            last_error: row.lastError,
            last_error_at: row.lastErrorAt,
          },
          { onConflict: 'path' },
        ),
      );
    },
  };
}
```

`lib/db/index.ts`:

```ts
import type { Repo } from '@/lib/db/repo';
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';

let repo: Repo | null = null;

/** The one database handle for the server. Tests replace this module with an in-memory repo. */
export function getRepo(): Repo {
  if (!repo) repo = createSupabaseRepo(createSupabaseClient());
  return repo;
}
```

- [ ] **Step 8: (Joey) Create the Supabase project and run the migration**

1. At `https://supabase.com/dashboard`, create a new project named `frc-fantasy` on the **Free** plan. Pick the region closest to Pennsylvania (East US). Save the database password somewhere safe.
2. Open **SQL Editor**, paste the whole of `supabase/migrations/0001_init.sql`, and press **Run**. Expected: "Success. No rows returned".
3. Open **Table Editor**. Expected: seven tables, each showing an "RLS enabled" badge.
4. Open **Project Settings → API**. Copy the **Project URL** and the **service_role** key (not the anon key) into `.env.local`:

```
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=the-long-service-role-key
CREATE_LEAGUE_PASSCODE=pick-a-passphrase-the-family-wont-guess
```

The service role key can read and write everything. It only ever goes in `.env.local` and in Vercel's environment variables.

- [ ] **Step 9: Write and run the real-database smoke script**

This is the only check that the snake_case mapping and the constraint names match the real database.

`scripts/db-smoke.ts`:

```ts
// Runs a create / read / constraint / delete cycle against the real Supabase project.
// Usage: npx tsx --env-file=.env.local scripts/db-smoke.ts
import { UniqueViolation } from '@/lib/db/repo';
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';
import { defaultScoring } from '@/lib/scoring/config';

function check(label: string, ok: boolean) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!ok) process.exitCode = 1;
}

async function constraintOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (err) {
    if (err instanceof UniqueViolation) return err.constraint;
    throw err;
  }
}

async function main() {
  const repo = createSupabaseRepo(createSupabaseClient());
  const slug = `smoke-test-${Date.now().toString(36)}`;
  const league = await repo.createLeague({
    slug,
    name: 'Smoke Test',
    adminTokenHash: 'not-a-real-hash',
    defaultScoring: defaultScoring(),
  });
  try {
    check('league round-trips', (await repo.getLeagueBySlug(slug))?.defaultScoring.qualWin === 3);

    const mom = await repo.createPlayer(league.id, 'Mom');
    check('player name is case-insensitive unique',
      (await constraintOf(repo.createPlayer(league.id, 'mom'))) === 'players_league_name_ci');

    const round = await repo.createRound({
      leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
      startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
      scoring: defaultScoring(),
    });
    check('round defaults', round.rosterSize === 4 && round.draftOrder.length === 0 && round.finalizedAt === null);
    check('round dates are YYYY-MM-DD', round.startDate === '2025-10-25');
    check('same event twice is rejected',
      (await constraintOf(repo.createRound({
        leagueId: league.id, eventKey: '2025parr', eventName: 'x',
        startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
        scoring: defaultScoring(),
      }))) === 'rounds_league_event_key');

    const updated = await repo.updateRound(round.id, { draftOrder: [mom.id], rosterSize: 2 });
    check('draft order saves', updated.draftOrder[0] === mom.id && updated.rosterSize === 2);

    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc341B' });
    check('team taken is rejected',
      (await constraintOf(repo.insertPick({ roundId: round.id, pickNumber: 1, playerId: mom.id, teamKey: 'frc341B' }))) === 'picks_round_team_key');
    check('pick number taken is rejected',
      (await constraintOf(repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc25' }))) === 'picks_round_pick_number_key');

    const path = `/smoke/${slug}`;
    await repo.upsertCache({ path, etag: null, body: null, fetchedAt: new Date().toISOString(), lastError: null, lastErrorAt: null });
    check('cache stores a null body', (await repo.getCache(path))?.body === null);
  } finally {
    await repo.deleteLeague(league.id);
  }
  check('league delete cascades', (await repo.getLeagueBySlug(slug)) === null);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

`tsx` does not read the `@/` alias from `vitest.config.ts`; it reads `paths` from `tsconfig.json`, which Task 1 set up.

Run:

```bash
npx tsx --env-file=.env.local scripts/db-smoke.ts
```

Expected: every line starts with `ok`. The smoke cache row under `/smoke/...` is harmless and can stay.

- [ ] **Step 10: Commit**

```bash
npm test && npm run typecheck
git add supabase lib/db tests/helpers/memoryRepo.ts tests/db scripts/db-smoke.ts
git commit -m "feat: database schema and Repo layer"
```

---

### Task 13: TBA client with the Postgres cache

**Files:**
- Create: `lib/tba/client.ts`, `lib/tba/event.ts`
- Test: `tests/tba/client.test.ts`, `tests/tba/event.test.ts`

**Interfaces:**
- Consumes: `getRepo` from `@/lib/db`; `CacheRow` from `@/lib/db/types`; `EventData` from `@/lib/tba/types`.
- Produces from `@/lib/tba/client`:
  - `type TbaResult<T> = { data: T | null; fetchedAt: string | null; stale: boolean }`
  - `interface CacheStore { getCache(path: string): Promise<CacheRow | null>; upsertCache(row: CacheRow): Promise<void> }`
  - `type TbaDeps = { store: CacheStore; fetchImpl: typeof fetch; now: () => Date; apiKey: string | undefined }`
  - `getTba<T>(path: string, opts: { windowMs: number; force?: boolean }, deps?: Partial<TbaDeps>): Promise<TbaResult<T>>`
- Produces from `@/lib/tba/event`:
  - `eventPaths(eventKey: string): Record<keyof EventData, string>`
  - `type LoadedEvent = { data: EventData; fetchedAt: string | null; stale: boolean }`
  - `loadEventData(eventKey: string, opts: { windowMs: number; force?: boolean }): Promise<LoadedEvent>`

- [ ] **Step 1: Write the failing client test**

`tests/tba/client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { CacheRow } from '@/lib/db/types';
import { getTba, type CacheStore } from '@/lib/tba/client';

const PATH = '/event/2025parr/rankings';
const NOW = new Date('2026-10-24T18:00:00.000Z');
const MIN = 60_000;

function cached(ageMs: number, extra: Partial<CacheRow> = {}): CacheRow {
  return {
    path: PATH,
    etag: '"v1"',
    body: { version: 1 },
    fetchedAt: new Date(NOW.getTime() - ageMs).toISOString(),
    lastError: null,
    lastErrorAt: null,
    ...extra,
  };
}

function storeWith(row?: CacheRow): CacheStore & { rows: Map<string, CacheRow> } {
  const rows = new Map<string, CacheRow>();
  if (row) rows.set(row.path, row);
  return {
    rows,
    getCache: async (path) => rows.get(path) ?? null,
    upsertCache: async (r) => {
      rows.set(r.path, r);
    },
  };
}

function ok(body: unknown, etag = '"v2"'): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { etag } });
}

function deps(store: CacheStore, fetchImpl: typeof fetch) {
  return { store, fetchImpl, now: () => NOW, apiKey: 'test-key' };
}

describe('getTba (§7.3)', () => {
  it('returns the cache without fetching when it is fresh', async () => {
    const fetchImpl = vi.fn();
    const out = await getTba(PATH, { windowMs: MIN }, deps(storeWith(cached(30_000)), fetchImpl));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out).toEqual({ data: { version: 1 }, fetchedAt: cached(30_000).fetchedAt, stale: false });
  });

  it('sends the key, the etag, no-store, and a timeout signal', async () => {
    const fetchImpl = vi.fn(async () => ok({ version: 2 }));
    await getTba(PATH, { windowMs: MIN }, deps(storeWith(cached(2 * MIN)), fetchImpl));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://www.thebluealliance.com/api/v3${PATH}`);
    const headers = new Headers(init.headers);
    expect(headers.get('X-TBA-Auth-Key')).toBe('test-key');
    expect(headers.get('If-None-Match')).toBe('"v1"');
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('200: stores the new body and etag', async () => {
    const store = storeWith(cached(2 * MIN, { lastError: 'old problem', lastErrorAt: NOW.toISOString() }));
    const out = await getTba(PATH, { windowMs: MIN }, deps(store, vi.fn(async () => ok({ version: 2 }))));
    expect(out).toEqual({ data: { version: 2 }, fetchedAt: NOW.toISOString(), stale: false });
    expect(store.rows.get(PATH)).toEqual({
      path: PATH, etag: '"v2"', body: { version: 2 },
      fetchedAt: NOW.toISOString(), lastError: null, lastErrorAt: null,
    });
  });

  it('200 with no cache row yet: fetches without If-None-Match', async () => {
    const fetchImpl = vi.fn(async () => ok([1, 2, 3]));
    const store = storeWith();
    const out = await getTba(PATH, { windowMs: MIN }, deps(store, fetchImpl));
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).has('If-None-Match')).toBe(false);
    expect(out.data).toEqual([1, 2, 3]);
    expect(store.rows.get(PATH)?.body).toEqual([1, 2, 3]);
  });

  it('200 with a JSON null body: stores null', async () => {
    const store = storeWith();
    const out = await getTba(PATH, { windowMs: MIN }, deps(store, vi.fn(async () => ok(null))));
    expect(out).toEqual({ data: null, fetchedAt: NOW.toISOString(), stale: false });
    expect(store.rows.get(PATH)?.body).toBeNull();
  });

  it('304: keeps the body, moves fetchedAt forward, clears the error', async () => {
    const store = storeWith(cached(2 * MIN, { lastError: 'old problem', lastErrorAt: NOW.toISOString() }));
    const fetchImpl = vi.fn(async () => new Response(null, { status: 304 }));
    const out = await getTba(PATH, { windowMs: MIN }, deps(store, fetchImpl));
    expect(out).toEqual({ data: { version: 1 }, fetchedAt: NOW.toISOString(), stale: false });
    expect(store.rows.get(PATH)).toMatchObject({ etag: '"v1"', fetchedAt: NOW.toISOString(), lastError: null });
  });

  it('404: means "no data", stored as null, not an error', async () => {
    const store = storeWith(cached(2 * MIN));
    const fetchImpl = vi.fn(async () => new Response('{"Error":"nope"}', { status: 404 }));
    const out = await getTba(PATH, { windowMs: MIN }, deps(store, fetchImpl));
    expect(out).toEqual({ data: null, fetchedAt: NOW.toISOString(), stale: false });
    expect(store.rows.get(PATH)).toMatchObject({ body: null, etag: null, lastError: null });
  });

  it('timeout: serves the old data as stale and records the error', async () => {
    const store = storeWith(cached(2 * MIN));
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('The operation timed out', 'TimeoutError');
    });
    const out = await getTba(PATH, { windowMs: MIN }, deps(store, fetchImpl));
    expect(out).toEqual({ data: { version: 1 }, fetchedAt: cached(2 * MIN).fetchedAt, stale: true });
    expect(store.rows.get(PATH)).toMatchObject({
      body: { version: 1 },
      fetchedAt: cached(2 * MIN).fetchedAt,
      lastError: 'TBA timed out',
      lastErrorAt: NOW.toISOString(),
    });
  });

  it.each([500, 503, 401])('HTTP %i: serves the old data as stale', async (status) => {
    const store = storeWith(cached(2 * MIN));
    const out = await getTba(PATH, { windowMs: MIN }, deps(store, vi.fn(async () => new Response('x', { status }))));
    expect(out.stale).toBe(true);
    expect(out.data).toEqual({ version: 1 });
    expect(store.rows.get(PATH)?.lastError).toBe(`TBA returned HTTP ${status}`);
  });

  it('failure with nothing cached: returns null and stale, stores nothing', async () => {
    const store = storeWith();
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const out = await getTba(PATH, { windowMs: MIN }, deps(store, fetchImpl));
    expect(out).toEqual({ data: null, fetchedAt: null, stale: true });
    expect(store.rows.size).toBe(0);
  });

  it('unreadable JSON in a 200 counts as a failure', async () => {
    const store = storeWith(cached(2 * MIN));
    const out = await getTba(PATH, { windowMs: MIN }, deps(store, vi.fn(async () => new Response('<html>', { status: 200 }))));
    expect(out.stale).toBe(true);
    expect(out.data).toEqual({ version: 1 });
  });

  it('a missing API key counts as a failure and does not fetch', async () => {
    const fetchImpl = vi.fn();
    const out = await getTba(PATH, { windowMs: MIN }, { ...deps(storeWith(cached(2 * MIN)), fetchImpl), apiKey: undefined });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out.stale).toBe(true);
  });

  it('force: refetches even inside the cache window', async () => {
    const fetchImpl = vi.fn(async () => ok({ version: 2 }));
    const out = await getTba(PATH, { windowMs: 10 * MIN, force: true }, deps(storeWith(cached(30_000)), fetchImpl));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.data).toEqual({ version: 2 });
  });

  it('force: is ignored when the row is under 15 s old (§8.3)', async () => {
    const fetchImpl = vi.fn();
    const out = await getTba(PATH, { windowMs: 10 * MIN, force: true }, deps(storeWith(cached(14_000)), fetchImpl));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out).toEqual({ data: { version: 1 }, fetchedAt: cached(14_000).fetchedAt, stale: false });
  });

  it('rejects a path that does not start with a slash', async () => {
    await expect(getTba('event/x', { windowMs: MIN }, deps(storeWith(), vi.fn()))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/tba/client.test.ts`
Expected: FAIL, cannot resolve `@/lib/tba/client`.

- [ ] **Step 3: Implement the client**

`lib/tba/client.ts`:

```ts
import { getRepo } from '@/lib/db';
import type { CacheRow } from '@/lib/db/types';

const TBA_BASE = 'https://www.thebluealliance.com/api/v3';
const TIMEOUT_MS = 5_000;
const FORCE_MIN_AGE_MS = 15_000;

export type TbaResult<T> = { data: T | null; fetchedAt: string | null; stale: boolean };

export interface CacheStore {
  getCache(path: string): Promise<CacheRow | null>;
  upsertCache(row: CacheRow): Promise<void>;
}

export type TbaDeps = {
  store: CacheStore;
  fetchImpl: typeof fetch;
  now: () => Date;
  apiKey: string | undefined;
};

/**
 * Reads one TBA endpoint through the tba_cache table (spec §7.3).
 * Never throws for TBA problems: it returns the last good data with stale = true.
 * `deps` exists so tests can pass a fake store, fetch, and clock.
 */
export async function getTba<T>(
  path: string,
  opts: { windowMs: number; force?: boolean },
  deps: Partial<TbaDeps> = {},
): Promise<TbaResult<T>> {
  if (!path.startsWith('/')) throw new Error(`TBA path must start with "/": ${path}`);

  const store = deps.store ?? getRepo();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = (deps.now ?? (() => new Date()))();
  const apiKey = 'apiKey' in deps ? deps.apiKey : process.env.TBA_API_KEY;

  const row = await store.getCache(path);
  if (row) {
    const age = now.getTime() - Date.parse(row.fetchedAt);
    const fresh = opts.force ? age < FORCE_MIN_AGE_MS : age < opts.windowMs;
    if (fresh) return { data: row.body as T | null, fetchedAt: row.fetchedAt, stale: false };
  }

  const failed = async (message: string): Promise<TbaResult<T>> => {
    if (!row) return { data: null, fetchedAt: null, stale: true };
    await store.upsertCache({ ...row, lastError: message, lastErrorAt: now.toISOString() });
    return { data: row.body as T | null, fetchedAt: row.fetchedAt, stale: true };
  };

  if (!apiKey) return failed('TBA_API_KEY is not set');

  let res: Response;
  try {
    const headers: Record<string, string> = { 'X-TBA-Auth-Key': apiKey, Accept: 'application/json' };
    if (row?.etag) headers['If-None-Match'] = row.etag;
    res = await fetchImpl(`${TBA_BASE}${path}`, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return failed('TBA timed out');
    return failed(`TBA request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const fetchedAt = now.toISOString();
  const save = async (etag: string | null, body: unknown | null): Promise<TbaResult<T>> => {
    await store.upsertCache({ path, etag, body, fetchedAt, lastError: null, lastErrorAt: null });
    return { data: body as T | null, fetchedAt, stale: false };
  };

  if (res.status === 304 && row) return save(row.etag, row.body);
  if (res.status === 404) return save(null, null);
  if (res.status === 200) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return failed('TBA sent a response that was not JSON');
    }
    return save(res.headers.get('etag'), body ?? null);
  }
  return failed(`TBA returned HTTP ${res.status}`);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/tba/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `loadEventData` test**

`tests/tba/event.test.ts`:

```ts
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
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run tests/tba/event.test.ts`
Expected: FAIL, cannot resolve `@/lib/tba/event`.

- [ ] **Step 7: Implement `loadEventData`**

`lib/tba/event.ts`:

```ts
import { getTba } from '@/lib/tba/client';
import type { EventData } from '@/lib/tba/types';

export function eventPaths(eventKey: string): Record<keyof EventData, string> {
  const base = `/event/${eventKey}`;
  return {
    teams: `${base}/teams/simple`,
    matches: `${base}/matches/simple`,
    rankings: `${base}/rankings`,
    alliances: `${base}/alliances`,
    awards: `${base}/awards`,
    oprs: `${base}/oprs`,
  };
}

export type LoadedEvent = { data: EventData; fetchedAt: string | null; stale: boolean };

/** Fetches everything the scoring engine needs for one event, in parallel. */
export async function loadEventData(
  eventKey: string,
  opts: { windowMs: number; force?: boolean },
): Promise<LoadedEvent> {
  const paths = eventPaths(eventKey);
  const names = Object.keys(paths) as (keyof EventData)[];
  const results = await Promise.all(names.map((name) => getTba<unknown>(paths[name], opts)));

  const data = Object.fromEntries(names.map((name, i) => [name, results[i].data])) as EventData;
  const times = results.map((r) => r.fetchedAt).filter((t): t is string => t !== null);
  return {
    data,
    // ISO timestamps sort correctly as strings. The oldest one is the honest "last updated".
    fetchedAt: times.length > 0 ? times.sort()[0] : null,
    stale: results.some((r) => r.stale),
  };
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npx vitest run tests/tba && npm run typecheck`
Expected: PASS; typecheck prints nothing.

- [ ] **Step 9: Commit**

```bash
git add lib/tba/client.ts lib/tba/event.ts tests/tba
git commit -m "feat: TBA client with Postgres cache"
```

---

### Task 14: Commissioner tokens and league slugs

**Files:**
- Create: `lib/auth/commissioner.ts`
- Test: `tests/auth/commissioner.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `generateAdminToken(): string` — 32 random bytes, base64url (43 characters)
  - `hashToken(token: string): string` — hex SHA-256 (64 characters)
  - `verifyToken(token: string, storedHash: string): boolean` — constant-time
  - `safeEqual(a: string, b: string): boolean` — constant-time string compare (for the site passcode)
  - `makeSlug(name: string): string` — e.g. `habich-fam-k3x9qd`
  - `SLUG_RE: RegExp`

- [ ] **Step 1: Write the failing test**

`tests/auth/commissioner.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  generateAdminToken,
  hashToken,
  makeSlug,
  safeEqual,
  SLUG_RE,
  verifyToken,
} from '@/lib/auth/commissioner';

describe('admin tokens (§4)', () => {
  it('generates 32 random bytes as base64url', () => {
    const token = generateAdminToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(generateAdminToken()).not.toBe(token);
  });

  it('hashes with SHA-256 as hex', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('verifies the right token and rejects everything else', () => {
    const token = generateAdminToken();
    const hash = hashToken(token);
    expect(verifyToken(token, hash)).toBe(true);
    expect(verifyToken(`${token}x`, hash)).toBe(false);
    expect(verifyToken(generateAdminToken(), hash)).toBe(false);
    expect(verifyToken('', hash)).toBe(false);
    expect(verifyToken(hash, hash)).toBe(false); // the hash itself is not the token
  });

  it('rejects absurdly long tokens and broken stored hashes without throwing', () => {
    const token = generateAdminToken();
    expect(verifyToken('x'.repeat(10_000), hashToken(token))).toBe(false);
    expect(verifyToken(token, 'not-hex')).toBe(false);
    expect(verifyToken(token, '')).toBe(false);
  });
});

describe('safeEqual', () => {
  it('compares strings of any length', () => {
    expect(safeEqual('ramp riot', 'ramp riot')).toBe(true);
    expect(safeEqual('ramp riot', 'ramp riot!')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });
});

describe('makeSlug', () => {
  it('is the name plus six random base32 characters', () => {
    expect(makeSlug('Habich Fam')).toMatch(/^habich-fam-[a-z2-7]{6}$/);
  });
  it('differs each time', () => {
    expect(makeSlug('Habich Fam')).not.toBe(makeSlug('Habich Fam'));
  });
  it('cleans up punctuation, accents, and extra spaces', () => {
    expect(makeSlug("  Joey's  Léague!! ")).toMatch(/^joey-s-league-[a-z2-7]{6}$/);
  });
  it('falls back to "league" when nothing usable is left', () => {
    expect(makeSlug('!!!')).toMatch(/^league-[a-z2-7]{6}$/);
    expect(makeSlug('🤖🤖')).toMatch(/^league-[a-z2-7]{6}$/);
  });
  it('caps the name part at 30 characters and never ends it with a dash', () => {
    const slug = makeSlug('a'.repeat(29) + ' bbbbbbbb');
    expect(slug).toMatch(/^a{29}-[a-z2-7]{6}$/);
  });
  it('always matches SLUG_RE', () => {
    for (const name of ['Habich Fam', '!!!', 'x'.repeat(80), '5181 Friends']) {
      expect(makeSlug(name)).toMatch(SLUG_RE);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/auth/commissioner.test.ts`
Expected: FAIL, cannot resolve `@/lib/auth/commissioner`.

- [ ] **Step 3: Implement**

`lib/auth/commissioner.ts`:

```ts
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const MAX_TOKEN_LENGTH = 200;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function generateAdminToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return sha256(token).toString('hex');
}

/** Constant-time compare. Hashing first makes both sides the same length. */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

export function verifyToken(token: string, storedHash: string): boolean {
  if (!token || token.length > MAX_TOKEN_LENGTH) return false;
  if (!/^[0-9a-f]{64}$/.test(storedHash)) return false;
  return timingSafeEqual(sha256(token), Buffer.from(storedHash, 'hex'));
}

export function makeSlug(name: string): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // strip accents
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30)
      .replace(/-+$/, '') || 'league';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += BASE32[randomInt(BASE32.length)];
  return `${base}-${suffix}`;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/auth/commissioner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/auth tests/auth
git commit -m "feat: commissioner tokens and league slugs"
```

---

### Task 15: HTTP helpers for route handlers

**Files:**
- Create: `lib/api/http.ts`
- Create: `tests/helpers/api.ts`
- Test: `tests/api/http.test.ts`

**Interfaces:**
- Consumes: `getRepo` (Task 12), `UniqueViolation`, `DbUnavailableError` (Task 12), `verifyToken`, `hashToken`, `generateAdminToken` (Task 14), `createMemoryRepo` (Task 12).
- Produces from `@/lib/api/http`:
  - `class HttpError extends Error { status: number }`
  - `isUuid(s: string): boolean`, `UUID_RE`
  - `json(data: unknown, status?: number): Response`, `noContent(): Response`, `jsonError(status: number, message: string): Response` — error bodies are `{ "error": "message" }`
  - `handle(fn: () => Promise<Response>): Promise<Response>` — turns thrown errors into responses
  - `parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>>` — throws `HttpError(400)`
  - `requireCommissioner(req: Request, slug: string): Promise<LeagueRow>` — throws `HttpError(403)`
  - `requireRound(league: LeagueRow, roundId: string): Promise<RoundRow>` — throws `HttpError(404)`
  - `DB_ASLEEP_MESSAGE: string`
- Produces from `tests/helpers/api.ts`:
  - `request(method: string, path: string, opts?: { token?: string; body?: unknown }): Request`
  - `params<T>(value: T): { params: Promise<T> }`
  - `seedLeague(repo: Repo, opts?: { name?: string; slug?: string }): Promise<{ league: LeagueRow; token: string }>`
  - `readJson(res: Response): Promise<any>`

- [ ] **Step 1: Write the test helpers**

`tests/helpers/api.ts`:

```ts
import { generateAdminToken, hashToken } from '@/lib/auth/commissioner';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';

/** Builds a Request like the browser would send. A string body is sent as-is (for bad-JSON tests). */
export function request(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Request {
  const headers = new Headers();
  if (opts.token !== undefined) headers.set('x-commissioner-key', opts.token);
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  return new Request(`http://test.local${path}`, { method, headers, body });
}

/** Next.js 16 passes route params as a Promise. */
export function params<T>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) };
}

export async function seedLeague(
  repo: Repo,
  opts: { name?: string; slug?: string } = {},
): Promise<{ league: LeagueRow; token: string }> {
  const token = generateAdminToken();
  const league = await repo.createLeague({
    slug: opts.slug ?? 'habich-fam-abc234',
    name: opts.name ?? 'Habich Fam',
    adminTokenHash: hashToken(token),
    defaultScoring: defaultScoring(),
  });
  return { league, token };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson(res: Response): Promise<any> {
  return res.json();
}
```

- [ ] **Step 2: Write the failing test**

`tests/api/http.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import {
  DB_ASLEEP_MESSAGE,
  handle,
  HttpError,
  isUuid,
  json,
  parseBody,
  requireCommissioner,
  requireRound,
} from '@/lib/api/http';
import { DbUnavailableError, UniqueViolation, type Repo } from '@/lib/db/repo';
import { defaultScoring } from '@/lib/scoring/config';
import { readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;

beforeEach(() => {
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
    expect(await status(new UniqueViolation('something_else'))).toEqual([409, 'That already exists']);
  });

  it('reports a sleeping database as 503 with the friendly message', async () => {
    expect(await status(new DbUnavailableError('fetch failed'))).toEqual([503, DB_ASLEEP_MESSAGE]);
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

describe('requireCommissioner (§4)', () => {
  it('returns the league for the right token', async () => {
    const { league, token } = await seedLeague(repo);
    const out = await requireCommissioner(request('GET', '/x', { token }), league.slug);
    expect(out.id).toBe(league.id);
  });

  it('answers 403 with no detail for a missing token, a wrong token, or an unknown league', async () => {
    const { league, token } = await seedLeague(repo);
    const cases = [
      requireCommissioner(request('GET', '/x'), league.slug),
      requireCommissioner(request('GET', '/x', { token: 'wrong' }), league.slug),
      requireCommissioner(request('GET', '/x', { token: '' }), league.slug),
      requireCommissioner(request('GET', '/x', { token }), 'no-such-league'),
    ];
    for (const attempt of cases) {
      await expect(attempt).rejects.toMatchObject({ status: 403, message: 'Forbidden' });
    }
  });

  it("rejects league A's token on league B", async () => {
    const a = await seedLeague(repo, { slug: 'league-a-aaaaaa' });
    const b = await seedLeague(repo, { slug: 'league-b-bbbbbb' });
    const attempt = requireCommissioner(request('GET', '/x', { token: a.token }), b.league.slug);
    await expect(attempt).rejects.toMatchObject({ status: 403 });
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
    const a = await seedLeague(repo, { slug: 'league-a-aaaaaa' });
    const b = await seedLeague(repo, { slug: 'league-b-bbbbbb' });
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
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run tests/api/http.test.ts`
Expected: FAIL, cannot resolve `@/lib/api/http`.

- [ ] **Step 4: Implement**

`lib/api/http.ts`:

```ts
import type { z } from 'zod';
import { verifyToken } from '@/lib/auth/commissioner';
import { getRepo } from '@/lib/db';
import { DbUnavailableError, UniqueViolation } from '@/lib/db/repo';
import type { LeagueRow, RoundRow } from '@/lib/db/types';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export const DB_ASLEEP_MESSAGE =
  'The league database is asleep — the commissioner needs to wake it up';

const CONSTRAINT_MESSAGES: Record<string, string> = {
  picks_round_team_key: 'That team was just taken',
  picks_round_pick_number_key: 'Draft changed in another tab — refresh',
  players_league_name_ci: "There's already a player with that name",
  rounds_league_event_key: 'That event is already in this league',
};

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

export function jsonError(status: number, message: string): Response {
  return json({ error: message }, status);
}

/** Wrap every route handler body in this. It is the one place errors become responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return jsonError(err.status, err.message);
    if (err instanceof UniqueViolation) {
      return jsonError(409, CONSTRAINT_MESSAGES[err.constraint] ?? 'That already exists');
    }
    if (err instanceof DbUnavailableError) return jsonError(503, DB_ASLEEP_MESSAGE);
    console.error(err);
    return jsonError(500, 'Something went wrong');
  }
}

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, 'Request body must be JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    // Custom messages written in our schemas already read well on their own.
    const custom = issue.code === 'custom' || !/^(Invalid|Too|Unrecognized)/.test(issue.message);
    throw new HttpError(400, custom ? issue.message : `${where}${issue.message}`);
  }
  return parsed.data;
}

export async function requireCommissioner(req: Request, slug: string): Promise<LeagueRow> {
  const token = req.headers.get('x-commissioner-key') ?? '';
  const league = await getRepo().getLeagueBySlug(slug);
  // Same answer for "no such league" and "wrong token": give nothing away.
  if (!league || !verifyToken(token, league.adminTokenHash)) throw new HttpError(403, 'Forbidden');
  return league;
}

export async function requireRound(league: LeagueRow, roundId: string): Promise<RoundRow> {
  if (!isUuid(roundId)) throw new HttpError(404, 'Round not found');
  const round = await getRepo().getRound(roundId);
  if (!round || round.leagueId !== league.id) throw new HttpError(404, 'Round not found');
  return round;
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run tests/api/http.test.ts`
Expected: PASS.

If `gives a readable 400 for invalid input` or `naming the field` fails, print `parsed.error.issues[0]` for that input and adjust only the `custom` test inside `parseBody` so that: a message we wrote in a schema is returned unchanged, and a zod built-in message is prefixed with the field path. Do not change the tests.

- [ ] **Step 6: Commit**

```bash
git add lib/api/http.ts tests/helpers/api.ts tests/api/http.test.ts
git commit -m "feat: HTTP helpers for route handlers"
```

---

### Task 16: League endpoints (create, verify, state, update)

**Files:**
- Create: `app/api/leagues/route.ts`
- Create: `app/api/l/[slug]/admin/verify/route.ts`
- Create: `app/api/l/[slug]/admin/state/route.ts`
- Create: `app/api/l/[slug]/admin/league/route.ts`
- Create: `lib/api/types.ts`, `lib/rounds/usage.ts`
- Test: `tests/api/league.test.ts`

**Interfaces:**
- Consumes: `handle`, `json`, `parseBody`, `requireCommissioner`, `HttpError` (Task 15); `generateAdminToken`, `hashToken`, `makeSlug`, `safeEqual` (Task 14); `getRepo`, `UniqueViolation` (Task 12); `scoringConfigSchema`, `defaultScoring` (Task 2); `roundStatus` (Task 10).
- Produces:
  - `POST /api/leagues` → 201 `{ slug, adminToken }`
  - `GET /api/l/{slug}/admin/verify` → 200 `{ ok: true }`
  - `GET /api/l/{slug}/admin/state` → 200 `AdminState`
  - `PATCH /api/l/{slug}/admin/league` → 200 `{ league: AdminState['league'] }`
  - From `@/lib/api/types`: `type AdminState`, `type AdminLeague`, `type AdminPlayer`, `type AdminRoundSummary`
  - From `@/lib/rounds/usage`: `playersInUse(repo: Repo, leagueId: string): Promise<Set<string>>`
  - Route handler signature used everywhere in Part 2: `(req: Request, ctx: { params: Promise<{ slug: string; ... }> }) => Promise<Response>`

- [ ] **Step 1: Write the shared API types**

`lib/api/types.ts`:

```ts
import type { RoundStatus } from '@/lib/rounds/status';
import type { ScoringConfig } from '@/lib/scoring/config';

// Shapes the admin API returns. The admin pages import these, so server and client agree.

export type AdminLeague = {
  slug: string;
  name: string;
  homeTeamNumber: number;
  defaultScoring: ScoringConfig;
};

export type AdminPlayer = {
  id: string;
  name: string;
  /** True when the player has picks or adjustments, or is in any draft order. Such players can't be removed. */
  inUse: boolean;
};

export type AdminRoundSummary = {
  id: string;
  eventKey: string;
  eventName: string;
  startDate: string;
  endDate: string;
  status: RoundStatus;
  pickCount: number;
  totalPicks: number;
};

export type AdminState = {
  league: AdminLeague;
  players: AdminPlayer[];
  rounds: AdminRoundSummary[];
};
```

`lib/rounds/usage.ts`:

```ts
import type { Repo } from '@/lib/db/repo';

/** Players who can't be removed: in a draft order, or holding picks or adjustments (spec §5.4). */
export async function playersInUse(repo: Repo, leagueId: string): Promise<Set<string>> {
  const rounds = await repo.listRounds(leagueId);
  const roundIds = rounds.map((r) => r.id);
  const [picks, adjustments] = await Promise.all([
    repo.listPicksForRounds(roundIds),
    repo.listAdjustmentsForRounds(roundIds),
  ]);
  const used = new Set<string>();
  for (const r of rounds) for (const id of r.draftOrder) used.add(id);
  for (const p of picks) used.add(p.playerId);
  for (const a of adjustments) if (a.playerId) used.add(a.playerId);
  return used;
}
```

- [ ] **Step 2: Write the failing test**

`tests/api/league.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import { PATCH as patchLeague } from '@/app/api/l/[slug]/admin/league/route';
import { GET as getState } from '@/app/api/l/[slug]/admin/state/route';
import { GET as verify } from '@/app/api/l/[slug]/admin/verify/route';
import { POST as createLeague } from '@/app/api/leagues/route';
import { hashToken } from '@/lib/auth/commissioner';
import type { Repo } from '@/lib/db/repo';
import { DEFAULT_SCORING, defaultScoring } from '@/lib/scoring/config';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;

beforeEach(() => {
  repo = createMemoryRepo();
  h.repo = repo;
  vi.stubEnv('CREATE_LEAGUE_PASSCODE', 'open sesame');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/leagues', () => {
  it('creates a league and returns the token exactly once', async () => {
    const res = await createLeague(
      request('POST', '/api/leagues', { body: { name: 'Habich Fam', passcode: 'open sesame' } }),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.slug).toMatch(/^habich-fam-[a-z2-7]{6}$/);
    expect(body.adminToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const league = (await repo.getLeagueBySlug(body.slug))!;
    expect(league.name).toBe('Habich Fam');
    expect(league.adminTokenHash).toBe(hashToken(body.adminToken));
    expect(league.adminTokenHash).not.toContain(body.adminToken);
    expect(league.defaultScoring).toEqual(DEFAULT_SCORING);
  });

  it('answers 403 for a wrong passcode and creates nothing', async () => {
    const spy = vi.spyOn(repo, 'createLeague');
    const res = await createLeague(
      request('POST', '/api/leagues', { body: { name: 'Habich Fam', passcode: 'nope' } }),
    );
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it('answers 403 when the server has no passcode configured', async () => {
    vi.stubEnv('CREATE_LEAGUE_PASSCODE', '');
    const res = await createLeague(
      request('POST', '/api/leagues', { body: { name: 'Habich Fam', passcode: '' } }),
    );
    expect([400, 403]).toContain(res.status);
    expect(await repo.getLeagueBySlug('habich-fam')).toBeNull();
  });

  it('answers 400 for an empty or too-long name', async () => {
    for (const name of ['', '   ', 'x'.repeat(81)]) {
      const res = await createLeague(
        request('POST', '/api/leagues', { body: { name, passcode: 'open sesame' } }),
      );
      expect(res.status, JSON.stringify(name)).toBe(400);
    }
  });

  it('retries when the random slug is already taken', async () => {
    const real = repo.createLeague.bind(repo);
    let calls = 0;
    vi.spyOn(repo, 'createLeague').mockImplementation(async (input) => {
      calls += 1;
      if (calls === 1) {
        const { UniqueViolation } = await import('@/lib/db/repo');
        throw new UniqueViolation('leagues_slug_key');
      }
      return real(input);
    });
    const res = await createLeague(
      request('POST', '/api/leagues', { body: { name: 'Habich Fam', passcode: 'open sesame' } }),
    );
    expect(res.status).toBe(201);
    expect(calls).toBe(2);
  });
});

describe('GET /admin/verify', () => {
  it('answers 200 for the right token', async () => {
    const { league, token } = await seedLeague(repo);
    const res = await verify(request('GET', '/x', { token }), params({ slug: league.slug }));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true });
  });

  it('answers 403 for a missing or wrong token', async () => {
    const { league } = await seedLeague(repo);
    expect((await verify(request('GET', '/x'), params({ slug: league.slug }))).status).toBe(403);
    expect(
      (await verify(request('GET', '/x', { token: 'wrong' }), params({ slug: league.slug }))).status,
    ).toBe(403);
  });
});

describe('GET /admin/state', () => {
  it('returns the league, players, and rounds, and never the token hash', async () => {
    const { league, token } = await seedLeague(repo);
    const mom = await repo.createPlayer(league.id, 'Mom');
    const dad = await repo.createPlayer(league.id, 'Dad');
    const round = await repo.createRound({
      leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
      startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
      scoring: defaultScoring(),
    });
    await repo.updateRound(round.id, { draftOrder: [mom.id], rosterSize: 2 });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc341' });

    const res = await getState(request('GET', '/x', { token }), params({ slug: league.slug }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(league.adminTokenHash);
    expect(text).not.toContain('adminTokenHash');

    const body = JSON.parse(text);
    expect(body.league).toEqual({
      slug: league.slug, name: 'Habich Fam', homeTeamNumber: 5181, defaultScoring: DEFAULT_SCORING,
    });
    expect(body.players).toEqual([
      { id: mom.id, name: 'Mom', inUse: true },
      { id: dad.id, name: 'Dad', inUse: false },
    ]);
    expect(body.rounds).toEqual([
      {
        id: round.id, eventKey: '2025parr', eventName: 'Ramp Riot',
        startDate: '2025-10-25', endDate: '2025-10-25',
        status: 'drafting', pickCount: 1, totalPicks: 2,
      },
    ]);
  });

  it('answers 403 without a token', async () => {
    const { league } = await seedLeague(repo);
    expect((await getState(request('GET', '/x'), params({ slug: league.slug }))).status).toBe(403);
  });
});

describe('PATCH /admin/league', () => {
  it('renames the league', async () => {
    const { league, token } = await seedLeague(repo);
    const res = await patchLeague(
      request('PATCH', '/x', { token, body: { name: '  Robot Fam  ' } }),
      params({ slug: league.slug }),
    );
    expect(res.status).toBe(200);
    expect((await readJson(res)).league.name).toBe('Robot Fam');
    expect((await repo.getLeagueBySlug(league.slug))!.name).toBe('Robot Fam');
  });

  it('updates the default scoring and home team', async () => {
    const { league, token } = await seedLeague(repo);
    const scoring = { ...defaultScoring(), qualWin: 2 };
    const res = await patchLeague(
      request('PATCH', '/x', { token, body: { defaultScoring: scoring, homeTeamNumber: 341 } }),
      params({ slug: league.slug }),
    );
    expect(res.status).toBe(200);
    const saved = (await repo.getLeagueBySlug(league.slug))!;
    expect(saved.defaultScoring.qualWin).toBe(2);
    expect(saved.homeTeamNumber).toBe(341);
  });

  it('does not change existing rounds when the league default changes (§3.5)', async () => {
    const { league, token } = await seedLeague(repo);
    const round = await repo.createRound({
      leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
      startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
      scoring: defaultScoring(),
    });
    await patchLeague(
      request('PATCH', '/x', { token, body: { defaultScoring: { ...defaultScoring(), qualWin: 2 } } }),
      params({ slug: league.slug }),
    );
    expect((await repo.getRound(round.id))!.scoring.qualWin).toBe(3);
  });

  it('answers 400 for invalid scoring, an empty patch, or unknown fields', async () => {
    const { league, token } = await seedLeague(repo);
    const bodies = [
      { defaultScoring: { ...defaultScoring(), qualWin: 1.5 } },
      {},
      { adminTokenHash: 'x' },
      { name: '' },
      { homeTeamNumber: 0 },
    ];
    for (const body of bodies) {
      const res = await patchLeague(request('PATCH', '/x', { token, body }), params({ slug: league.slug }));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('answers 403 with the wrong token and changes nothing', async () => {
    const { league } = await seedLeague(repo);
    const res = await patchLeague(
      request('PATCH', '/x', { token: 'wrong', body: { name: 'Hacked' } }),
      params({ slug: league.slug }),
    );
    expect(res.status).toBe(403);
    expect((await repo.getLeagueBySlug(league.slug))!.name).toBe('Habich Fam');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run tests/api/league.test.ts`
Expected: FAIL, cannot resolve the route modules.

- [ ] **Step 4: Implement the four routes**

`app/api/leagues/route.ts`:

```ts
import { z } from 'zod';
import { handle, HttpError, json, parseBody } from '@/lib/api/http';
import { generateAdminToken, hashToken, makeSlug, safeEqual } from '@/lib/auth/commissioner';
import { getRepo } from '@/lib/db';
import { UniqueViolation } from '@/lib/db/repo';
import { defaultScoring } from '@/lib/scoring/config';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  name: z
    .string('League name is required')
    .trim()
    .min(1, 'League name is required')
    .max(80, 'League name must be 80 characters or fewer'),
  passcode: z.string('Passcode is required').max(200, 'Passcode is too long'),
});

export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const body = await parseBody(req, bodySchema);
    const expected = process.env.CREATE_LEAGUE_PASSCODE;
    if (!expected || !safeEqual(body.passcode, expected)) throw new HttpError(403, 'Wrong passcode');

    const adminToken = generateAdminToken();
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const league = await getRepo().createLeague({
          slug: makeSlug(body.name),
          name: body.name,
          adminTokenHash: hashToken(adminToken),
          defaultScoring: defaultScoring(),
        });
        return json({ slug: league.slug, adminToken }, 201);
      } catch (err) {
        if (err instanceof UniqueViolation && err.constraint === 'leagues_slug_key') continue;
        throw err;
      }
    }
    throw new HttpError(500, 'Could not make a unique link. Try again.');
  });
}
```

`app/api/l/[slug]/admin/verify/route.ts`:

```ts
import { handle, json, requireCommissioner } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    await requireCommissioner(req, slug);
    return json({ ok: true });
  });
}
```

`app/api/l/[slug]/admin/state/route.ts`:

```ts
import { handle, json, requireCommissioner } from '@/lib/api/http';
import type { AdminState } from '@/lib/api/types';
import { getRepo } from '@/lib/db';
import { roundStatus } from '@/lib/rounds/status';
import { playersInUse } from '@/lib/rounds/usage';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const repo = getRepo();
    const now = new Date();

    const [players, rounds, used] = await Promise.all([
      repo.listPlayers(league.id),
      repo.listRounds(league.id),
      playersInUse(repo, league.id),
    ]);
    const picks = await repo.listPicksForRounds(rounds.map((r) => r.id));

    const state: AdminState = {
      league: {
        slug: league.slug,
        name: league.name,
        homeTeamNumber: league.homeTeamNumber,
        defaultScoring: league.defaultScoring,
      },
      players: players.map((p) => ({ id: p.id, name: p.name, inUse: used.has(p.id) })),
      rounds: rounds.map((r) => {
        const pickCount = picks.filter((p) => p.roundId === r.id).length;
        return {
          id: r.id,
          eventKey: r.eventKey,
          eventName: r.eventName,
          startDate: r.startDate,
          endDate: r.endDate,
          status: roundStatus(r, pickCount, now),
          pickCount,
          totalPicks: r.draftOrder.length * r.rosterSize,
        };
      }),
    };
    return json(state);
  });
}
```

`app/api/l/[slug]/admin/league/route.ts`:

```ts
import { z } from 'zod';
import { handle, json, parseBody, requireCommissioner } from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import { scoringConfigSchema } from '@/lib/scoring/config';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

const patchSchema = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1, 'League name is required')
      .max(80, 'League name must be 80 characters or fewer')
      .optional(),
    homeTeamNumber: z
      .number()
      .int()
      .min(1, 'Home team number must be between 1 and 99999')
      .max(99999, 'Home team number must be between 1 and 99999')
      .optional(),
    defaultScoring: scoringConfigSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change' });

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const patch = await parseBody(req, patchSchema);
    const saved = await getRepo().updateLeague(league.id, patch);
    return json({
      league: {
        slug: saved.slug,
        name: saved.name,
        homeTeamNumber: saved.homeTeamNumber,
        defaultScoring: saved.defaultScoring,
      },
    });
  });
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run tests/api/league.test.ts && npm run typecheck`
Expected: PASS; typecheck prints nothing.

zod 4 notes, in case of a type error: `z.string('message')` sets the message for a missing or non-string value, and `z.strictObject({...})` rejects unknown keys. If the installed zod version rejects either form, use `z.string({ error: 'message' })` and `z.object({...}).strict()`, which mean the same thing.

- [ ] **Step 6: Commit**

```bash
git add app/api lib/api/types.ts lib/rounds/usage.ts tests/api/league.test.ts
git commit -m "feat: league endpoints (create, verify, state, update)"
```

---

### Task 17: Player endpoints

**Files:**
- Create: `app/api/l/[slug]/admin/players/route.ts`
- Create: `app/api/l/[slug]/admin/players/[id]/route.ts`
- Test: `tests/api/players.test.ts`

**Interfaces:**
- Consumes: `handle`, `json`, `noContent`, `parseBody`, `requireCommissioner`, `HttpError`, `isUuid` (Task 15); `playersInUse` (Task 16); `getRepo` (Task 12); `AdminPlayer` (Task 16).
- Produces:
  - `POST /api/l/{slug}/admin/players` body `{ name }` → 201 `{ player: AdminPlayer }`; 409 name exists
  - `PATCH /api/l/{slug}/admin/players/{id}` body `{ name }` → 200 `{ player: AdminPlayer }`; 404; 409 name exists
  - `DELETE /api/l/{slug}/admin/players/{id}` → 204; 404; 409 player in use

- [ ] **Step 1: Write the failing test**

`tests/api/players.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import { DELETE as deletePlayer, PATCH as renamePlayer } from '@/app/api/l/[slug]/admin/players/[id]/route';
import { POST as addPlayer } from '@/app/api/l/[slug]/admin/players/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;
let token: string;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  ({ league, token } = await seedLeague(repo));
});

async function addRound() {
  return repo.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
    scoring: defaultScoring(),
  });
}

describe('POST /admin/players', () => {
  it('adds a player, trimming the name', async () => {
    const res = await addPlayer(
      request('POST', '/x', { token, body: { name: '  Mom ' } }),
      params({ slug: league.slug }),
    );
    expect(res.status).toBe(201);
    const { player } = await readJson(res);
    expect(player).toMatchObject({ name: 'Mom', inUse: false });
    expect((await repo.listPlayers(league.id)).map((p) => p.name)).toEqual(['Mom']);
  });

  it('answers 409 for a name that differs only by case', async () => {
    await repo.createPlayer(league.id, 'Mom');
    const res = await addPlayer(
      request('POST', '/x', { token, body: { name: 'mom' } }),
      params({ slug: league.slug }),
    );
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe("There's already a player with that name");
  });

  it('answers 400 for an empty or too-long name', async () => {
    for (const name of ['', '   ', 'x'.repeat(41)]) {
      const res = await addPlayer(
        request('POST', '/x', { token, body: { name } }),
        params({ slug: league.slug }),
      );
      expect(res.status, JSON.stringify(name)).toBe(400);
    }
  });

  it('answers 403 with a missing or wrong token', async () => {
    for (const t of [undefined, 'wrong']) {
      const res = await addPlayer(
        request('POST', '/x', { token: t, body: { name: 'Mom' } }),
        params({ slug: league.slug }),
      );
      expect(res.status).toBe(403);
    }
    expect(await repo.listPlayers(league.id)).toEqual([]);
  });
});

describe('PATCH /admin/players/{id}', () => {
  it('renames a player', async () => {
    const mom = await repo.createPlayer(league.id, 'Mom');
    const res = await renamePlayer(
      request('PATCH', '/x', { token, body: { name: 'Mother' } }),
      params({ slug: league.slug, id: mom.id }),
    );
    expect(res.status).toBe(200);
    expect((await readJson(res)).player.name).toBe('Mother');
  });

  it('lets a player change only the capitalization of their own name', async () => {
    const mom = await repo.createPlayer(league.id, 'mom');
    const res = await renamePlayer(
      request('PATCH', '/x', { token, body: { name: 'Mom' } }),
      params({ slug: league.slug, id: mom.id }),
    );
    expect(res.status).toBe(200);
  });

  it('answers 409 when the new name belongs to someone else', async () => {
    await repo.createPlayer(league.id, 'Mom');
    const dad = await repo.createPlayer(league.id, 'Dad');
    const res = await renamePlayer(
      request('PATCH', '/x', { token, body: { name: 'MOM' } }),
      params({ slug: league.slug, id: dad.id }),
    );
    expect(res.status).toBe(409);
  });

  it("answers 404 for an unknown id, a bad id, or another league's player", async () => {
    const other = await seedLeague(repo, { slug: 'other-league-bbbbbb' });
    const stranger = await repo.createPlayer(other.league.id, 'Stranger');
    for (const id of ['3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b', 'not-a-uuid', stranger.id]) {
      const res = await renamePlayer(
        request('PATCH', '/x', { token, body: { name: 'Hacked' } }),
        params({ slug: league.slug, id }),
      );
      expect(res.status, id).toBe(404);
    }
    expect((await repo.listPlayers(other.league.id))[0].name).toBe('Stranger');
  });
});

describe('DELETE /admin/players/{id}', () => {
  it('removes a player who is not in use', async () => {
    const mom = await repo.createPlayer(league.id, 'Mom');
    const res = await deletePlayer(request('DELETE', '/x', { token }), params({ slug: league.slug, id: mom.id }));
    expect(res.status).toBe(204);
    expect(await repo.listPlayers(league.id)).toEqual([]);
  });

  it('answers 409 for a player who is in a draft order', async () => {
    const mom = await repo.createPlayer(league.id, 'Mom');
    const round = await addRound();
    await repo.updateRound(round.id, { draftOrder: [mom.id] });
    const res = await deletePlayer(request('DELETE', '/x', { token }), params({ slug: league.slug, id: mom.id }));
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toMatch(/rename/i);
    expect(await repo.listPlayers(league.id)).toHaveLength(1);
  });

  it('answers 409 for a player who has an adjustment', async () => {
    const mom = await repo.createPlayer(league.id, 'Mom');
    const round = await addRound();
    await repo.insertAdjustment({ roundId: round.id, playerId: mom.id, teamKey: null, points: 5, reason: 'x' });
    const res = await deletePlayer(request('DELETE', '/x', { token }), params({ slug: league.slug, id: mom.id }));
    expect(res.status).toBe(409);
  });

  it("answers 404 for another league's player and leaves them alone", async () => {
    const other = await seedLeague(repo, { slug: 'other-league-bbbbbb' });
    const stranger = await repo.createPlayer(other.league.id, 'Stranger');
    const res = await deletePlayer(
      request('DELETE', '/x', { token }),
      params({ slug: league.slug, id: stranger.id }),
    );
    expect(res.status).toBe(404);
    expect(await repo.listPlayers(other.league.id)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/api/players.test.ts`
Expected: FAIL, cannot resolve the route modules.

- [ ] **Step 3: Implement**

`app/api/l/[slug]/admin/players/route.ts`:

```ts
import { z } from 'zod';
import { handle, json, parseBody, requireCommissioner } from '@/lib/api/http';
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

const bodySchema = z.object({
  name: z
    .string('Player name is required')
    .trim()
    .min(1, 'Player name is required')
    .max(40, 'Player name must be 40 characters or fewer'),
});

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const { name } = await parseBody(req, bodySchema);
    const player = await getRepo().createPlayer(league.id, name);
    return json({ player: { id: player.id, name: player.name, inUse: false } }, 201);
  });
}
```

`app/api/l/[slug]/admin/players/[id]/route.ts`:

```ts
import { z } from 'zod';
import {
  handle,
  HttpError,
  isUuid,
  json,
  noContent,
  parseBody,
  requireCommissioner,
} from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import type { LeagueRow, PlayerRow } from '@/lib/db/types';
import { playersInUse } from '@/lib/rounds/usage';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string; id: string }> };

const bodySchema = z.object({
  name: z
    .string('Player name is required')
    .trim()
    .min(1, 'Player name is required')
    .max(40, 'Player name must be 40 characters or fewer'),
});

async function requirePlayer(league: LeagueRow, id: string): Promise<PlayerRow> {
  if (!isUuid(id)) throw new HttpError(404, 'Player not found');
  const player = (await getRepo().listPlayers(league.id)).find((p) => p.id === id);
  if (!player) throw new HttpError(404, 'Player not found');
  return player;
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const player = await requirePlayer(league, id);
    const { name } = await parseBody(req, bodySchema);
    const repo = getRepo();
    const saved = await repo.renamePlayer(player.id, name);
    const used = await playersInUse(repo, league.id);
    return json({ player: { id: saved.id, name: saved.name, inUse: used.has(saved.id) } });
  });
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const player = await requirePlayer(league, id);
    const repo = getRepo();
    const used = await playersInUse(repo, league.id);
    if (used.has(player.id)) {
      throw new HttpError(
        409,
        `${player.name} is in a draft order or has picks or adjustments, so they can't be removed. You can rename them instead.`,
      );
    }
    await repo.deletePlayer(player.id);
    return noContent();
  });
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/api/players.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/l/[slug]/admin/players" tests/api/players.test.ts
git commit -m "feat: player endpoints"
```

---

### Task 18: Round endpoints and the team pool

**Files:**
- Create: `lib/rounds/pool.ts`, `lib/rounds/detail.ts`
- Modify: `lib/api/types.ts` (add `AdminRoundDetail`)
- Create: `app/api/l/[slug]/admin/rounds/route.ts`
- Create: `app/api/l/[slug]/admin/rounds/[id]/route.ts`
- Create: `app/api/l/[slug]/admin/rounds/[id]/teams/route.ts`
- Create: `app/api/l/[slug]/admin/rounds/[id]/teams/[teamKey]/route.ts`
- Test: `tests/api/rounds.test.ts`

**Interfaces:**
- Consumes: `getTba` (Task 13); `mergePool`, `parseTeamInput`, `normalizeEventKey`, `isTeamKey`, `PoolTeam` (Task 3); `cacheWindowFor`, `roundStatus`, `shouldNudgeFinalize`, `DEFAULT_WINDOW_MS` (Task 10); everything from Task 15; `scoringConfigSchema` (Task 2); `TbaEvent`, `TeamSimple` (Task 4).
- Produces:
  - From `@/lib/rounds/pool`: `loadPool(round: RoundRow, now: Date): Promise<{ teams: PoolTeam[]; stale: boolean }>`
  - From `@/lib/rounds/detail`: `roundDetail(round: RoundRow, now: Date): Promise<AdminRoundDetail>`
  - From `@/lib/api/types`: `type AdminRoundDetail` (Step 1)
  - `POST /api/l/{slug}/admin/rounds` body `{ eventKey }` → 201 `{ round: { id, eventKey, eventName, startDate, endDate } }`; 400 bad key; 404 unknown event; 409 already in league; 503 TBA unreachable
  - `GET /api/l/{slug}/admin/rounds/{id}` → 200 `AdminRoundDetail`
  - `PATCH /api/l/{slug}/admin/rounds/{id}` body `{ rosterSize?, draftOrder?, scoring?, finalized? }` → 200 `AdminRoundDetail`; 400; 409
  - `DELETE /api/l/{slug}/admin/rounds/{id}` → 204
  - `POST /api/l/{slug}/admin/rounds/{id}/teams` body `{ teamNumber }` → 201 `{ teamKey }`; 400
  - `DELETE /api/l/{slug}/admin/rounds/{id}/teams/{teamKey}` → 204; 409 team is drafted

- [ ] **Step 1: Add `AdminRoundDetail` to the shared types**

Append to `lib/api/types.ts`:

```ts
import type { PoolTeam } from '@/lib/teams';

export type AdminRoundDetail = {
  round: {
    id: string;
    eventKey: string;
    eventName: string;
    startDate: string;
    endDate: string;
    timezone: string;
    rosterSize: number;
    draftOrder: string[];
    scoring: ScoringConfig;
    finalizedAt: string | null;
  };
  status: RoundStatus;
  /** True when the event is over but the round isn't final yet (spec §5.5). */
  nudgeFinalize: boolean;
  /** Every player in the league, not only the ones drafting. */
  players: { id: string; name: string }[];
  pool: PoolTeam[];
  /** True when TBA couldn't be reached and the pool may be out of date. */
  poolStale: boolean;
  picks: { pickNumber: number; playerId: string; teamKey: string }[];
  adjustments: {
    id: string;
    playerId: string | null;
    teamKey: string | null;
    points: number;
    reason: string;
  }[];
  /** Largest roster size the pool allows for the current draft order, capped at 10. null with no drafters. */
  maxRosterSize: number | null;
};
```

Move the new `import type { PoolTeam }` line up to join the other imports at the top of the file.

- [ ] **Step 2: Write the failing test**

`tests/api/rounds.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import {
  DELETE as deleteRound,
  GET as getRound,
  PATCH as patchRound,
} from '@/app/api/l/[slug]/admin/rounds/[id]/route';
import { DELETE as removeTeam } from '@/app/api/l/[slug]/admin/rounds/[id]/teams/[teamKey]/route';
import { POST as addTeam } from '@/app/api/l/[slug]/admin/rounds/[id]/teams/route';
import { POST as addRound } from '@/app/api/l/[slug]/admin/rounds/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, PlayerRow, RoundRow } from '@/lib/db/types';
import { DEFAULT_SCORING, defaultScoring } from '@/lib/scoring/config';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;
let token: string;

const EVENT = {
  key: '2025parr',
  name: 'Ramp Riot',
  start_date: '2025-10-25',
  end_date: '2025-10-25',
  timezone: 'America/New_York',
  event_type: 99,
};

/** Six teams on TBA: frc1 .. frc6. */
const TBA_TEAMS = [1, 2, 3, 4, 5, 6].map((n) => ({ key: `frc${n}`, team_number: n, nickname: `Team ${n}` }));

function tbaAnswers(answers: Record<string, unknown>) {
  h.getTba = vi.fn(async (path: unknown) => {
    const data = answers[String(path)];
    return { data: data ?? null, fetchedAt: '2026-10-01T12:00:00.000Z', stale: false };
  });
}

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  ({ league, token } = await seedLeague(repo));
  tbaAnswers({ '/event/2025parr': EVENT, '/event/2025parr/teams/simple': TBA_TEAMS });
});

async function seedRound(): Promise<RoundRow> {
  return repo.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
    scoring: defaultScoring(),
  });
}

async function seedPlayers(...names: string[]): Promise<PlayerRow[]> {
  const out: PlayerRow[] = [];
  for (const name of names) out.push(await repo.createPlayer(league.id, name));
  return out;
}

const at = (round: RoundRow) => params({ slug: league.slug, id: round.id });

describe('POST /admin/rounds', () => {
  it('adds a round from a TBA event, copying the league scoring', async () => {
    await repo.updateLeague(league.id, { defaultScoring: { ...defaultScoring(), qualWin: 2 } });
    const res = await addRound(
      request('POST', '/x', { token, body: { eventKey: ' 2025PARR ' } }),
      params({ slug: league.slug }),
    );
    expect(res.status).toBe(201);
    const { round } = await readJson(res);
    expect(round).toMatchObject({
      eventKey: '2025parr', eventName: 'Ramp Riot', startDate: '2025-10-25', endDate: '2025-10-25',
    });
    const saved = (await repo.getRound(round.id))!;
    expect(saved.scoring.qualWin).toBe(2);
    expect(saved.timezone).toBe('America/New_York');
    expect(saved.rosterSize).toBe(4);
  });

  it('falls back to Eastern when TBA gives no timezone', async () => {
    tbaAnswers({ '/event/2025parr': { ...EVENT, timezone: null } });
    const res = await addRound(
      request('POST', '/x', { token, body: { eventKey: '2025parr' } }),
      params({ slug: league.slug }),
    );
    const { round } = await readJson(res);
    expect((await repo.getRound(round.id))!.timezone).toBe('America/New_York');
  });

  it('answers 404 when TBA has no such event', async () => {
    tbaAnswers({});
    const res = await addRound(
      request('POST', '/x', { token, body: { eventKey: '2026nope' } }),
      params({ slug: league.slug }),
    );
    expect(res.status).toBe(404);
    expect(await repo.listRounds(league.id)).toEqual([]);
  });

  it('answers 503 when TBA cannot be reached', async () => {
    h.getTba = vi.fn(async () => ({ data: null, fetchedAt: null, stale: true }));
    const res = await addRound(
      request('POST', '/x', { token, body: { eventKey: '2025parr' } }),
      params({ slug: league.slug }),
    );
    expect(res.status).toBe(503);
  });

  it('answers 409 when the event is already in the league', async () => {
    await seedRound();
    const res = await addRound(
      request('POST', '/x', { token, body: { eventKey: '2025parr' } }),
      params({ slug: league.slug }),
    );
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('That event is already in this league');
  });

  it('answers 400 for a malformed event key without calling TBA', async () => {
    for (const eventKey of ['parr', '2025 parr', '', 'https://tba/2025parr']) {
      const res = await addRound(
        request('POST', '/x', { token, body: { eventKey } }),
        params({ slug: league.slug }),
      );
      expect(res.status, eventKey).toBe(400);
    }
    expect(h.getTba).not.toHaveBeenCalled();
  });

  it('answers 403 without a token', async () => {
    const res = await addRound(
      request('POST', '/x', { body: { eventKey: '2025parr' } }),
      params({ slug: league.slug }),
    );
    expect(res.status).toBe(403);
  });
});

describe('GET /admin/rounds/{id}', () => {
  it('returns the round with its pool, players, picks, and adjustments', async () => {
    const round = await seedRound();
    const [mom, dad] = await seedPlayers('Mom', 'Dad');
    await repo.updateRound(round.id, { draftOrder: [mom.id, dad.id], rosterSize: 2 });
    await repo.addExtraTeam(round.id, 'frc9999');
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc1' });
    await repo.insertAdjustment({ roundId: round.id, playerId: null, teamKey: 'frc1', points: 5, reason: 'Award' });

    const res = await getRound(request('GET', '/x', { token }), at(round));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.round).toMatchObject({ id: round.id, rosterSize: 2, draftOrder: [mom.id, dad.id] });
    expect(body.round.scoring).toEqual(DEFAULT_SCORING);
    expect(body.status).toBe('drafting');
    expect(body.pool.map((t: { teamKey: string }) => t.teamKey)).toEqual([
      'frc1', 'frc2', 'frc3', 'frc4', 'frc5', 'frc6', 'frc9999',
    ]);
    expect(body.pool.at(-1)).toEqual({ teamKey: 'frc9999', label: '9999', nickname: null, manual: true });
    expect(body.poolStale).toBe(false);
    expect(body.players.map((p: { name: string }) => p.name)).toEqual(['Mom', 'Dad']);
    expect(body.picks).toEqual([{ pickNumber: 0, playerId: mom.id, teamKey: 'frc1' }]);
    expect(body.adjustments).toHaveLength(1);
    expect(body.maxRosterSize).toBe(3); // 7 teams / 2 players
  });

  it("answers 404 when league A's token asks for league B's round", async () => {
    const other = await seedLeague(repo, { slug: 'other-league-bbbbbb' });
    const theirs = await repo.createRound({
      leagueId: other.league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
      startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
      scoring: defaultScoring(),
    });
    const res = await getRound(request('GET', '/x', { token }), params({ slug: league.slug, id: theirs.id }));
    expect(res.status).toBe(404);
  });

  it('answers 404 for an id that is not a UUID', async () => {
    const res = await getRound(request('GET', '/x', { token }), params({ slug: league.slug, id: 'abc' }));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /admin/rounds/{id}', () => {
  it('sets the draft order and roster size', async () => {
    const round = await seedRound();
    const [mom, dad] = await seedPlayers('Mom', 'Dad');
    const res = await patchRound(
      request('PATCH', '/x', { token, body: { draftOrder: [dad.id, mom.id], rosterSize: 3 } }),
      at(round),
    );
    expect(res.status).toBe(200);
    expect((await readJson(res)).round).toMatchObject({ draftOrder: [dad.id, mom.id], rosterSize: 3 });
    expect((await repo.getRound(round.id))!.draftOrder).toEqual([dad.id, mom.id]);
  });

  it('answers 400 when players x roster size is more than the pool, and says the maximum', async () => {
    const round = await seedRound();
    const [mom, dad] = await seedPlayers('Mom', 'Dad');
    const res = await patchRound(
      request('PATCH', '/x', { token, body: { draftOrder: [mom.id, dad.id], rosterSize: 4 } }), // 8 > 6
      at(round),
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe('With 2 players and 6 teams, roster size can be at most 3');
    expect((await repo.getRound(round.id))!.draftOrder).toEqual([]);
  });

  it('counts manually added teams toward the pool size', async () => {
    const round = await seedRound();
    const [mom, dad] = await seedPlayers('Mom', 'Dad');
    await repo.addExtraTeam(round.id, 'frc9998');
    await repo.addExtraTeam(round.id, 'frc9999');
    const res = await patchRound(
      request('PATCH', '/x', { token, body: { draftOrder: [mom.id, dad.id], rosterSize: 4 } }), // 8 <= 8
      at(round),
    );
    expect(res.status).toBe(200);
  });

  it('answers 400 when the pool is too small for even one team each', async () => {
    tbaAnswers({ '/event/2025parr/teams/simple': null });
    const round = await seedRound();
    const [mom] = await seedPlayers('Mom');
    const res = await patchRound(
      request('PATCH', '/x', { token, body: { draftOrder: [mom.id], rosterSize: 1 } }),
      at(round),
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toMatch(/add teams/i);
  });

  it('answers 400 for a draft order with duplicates or non-players', async () => {
    const round = await seedRound();
    const [mom] = await seedPlayers('Mom');
    const other = await seedLeague(repo, { slug: 'other-league-bbbbbb' });
    const stranger = await repo.createPlayer(other.league.id, 'Stranger');
    const orders = [[mom.id, mom.id], [stranger.id], ['3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b'], ['not-a-uuid']];
    for (const draftOrder of orders) {
      const res = await patchRound(request('PATCH', '/x', { token, body: { draftOrder } }), at(round));
      expect(res.status, JSON.stringify(draftOrder)).toBe(400);
    }
  });

  it('answers 409 when changing draft order or roster size after a pick exists', async () => {
    const round = await seedRound();
    const [mom, dad] = await seedPlayers('Mom', 'Dad');
    await repo.updateRound(round.id, { draftOrder: [mom.id, dad.id], rosterSize: 2 });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc1' });

    for (const body of [{ draftOrder: [dad.id, mom.id] }, { rosterSize: 3 }]) {
      const res = await patchRound(request('PATCH', '/x', { token, body }), at(round));
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect((await readJson(res)).error).toMatch(/undo all picks/i);
    }
    expect((await repo.getRound(round.id))!).toMatchObject({ draftOrder: [mom.id, dad.id], rosterSize: 2 });
  });

  it('allows re-sending the same draft order and roster size after picks exist', async () => {
    const round = await seedRound();
    const [mom] = await seedPlayers('Mom');
    await repo.updateRound(round.id, { draftOrder: [mom.id], rosterSize: 2 });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc1' });
    const res = await patchRound(
      request('PATCH', '/x', { token, body: { draftOrder: [mom.id], rosterSize: 2 } }),
      at(round),
    );
    expect(res.status).toBe(200);
  });

  it('allows a scoring change after picks exist, and only for this round', async () => {
    const round = await seedRound();
    const [mom] = await seedPlayers('Mom');
    await repo.updateRound(round.id, { draftOrder: [mom.id], rosterSize: 2 });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc1' });
    const res = await patchRound(
      request('PATCH', '/x', { token, body: { scoring: { ...defaultScoring(), qualWin: 1 } } }),
      at(round),
    );
    expect(res.status).toBe(200);
    expect((await repo.getRound(round.id))!.scoring.qualWin).toBe(1);
    expect((await repo.getLeagueBySlug(league.slug))!.defaultScoring.qualWin).toBe(3);
  });

  it('marks a round final and reopens it', async () => {
    const round = await seedRound();
    const res1 = await patchRound(request('PATCH', '/x', { token, body: { finalized: true } }), at(round));
    expect((await readJson(res1)).status).toBe('final');
    expect((await repo.getRound(round.id))!.finalizedAt).not.toBeNull();

    const res2 = await patchRound(request('PATCH', '/x', { token, body: { finalized: false } }), at(round));
    expect((await readJson(res2)).status).toBe('setup');
    expect((await repo.getRound(round.id))!.finalizedAt).toBeNull();
  });

  it('leaves other fields alone when only one is patched', async () => {
    const round = await seedRound();
    const [mom] = await seedPlayers('Mom');
    await repo.updateRound(round.id, { draftOrder: [mom.id], rosterSize: 2 });
    await patchRound(request('PATCH', '/x', { token, body: { finalized: true } }), at(round));
    expect((await repo.getRound(round.id))!).toMatchObject({ draftOrder: [mom.id], rosterSize: 2 });
    expect((await repo.getRound(round.id))!.scoring).toEqual(DEFAULT_SCORING);
  });

  it('answers 400 for bad values, unknown fields, or an empty patch', async () => {
    const round = await seedRound();
    const bodies = [{ rosterSize: 0 }, { rosterSize: 11 }, { rosterSize: 2.5 }, { eventKey: '2026parr' }, {}];
    for (const body of bodies) {
      const res = await patchRound(request('PATCH', '/x', { token, body }), at(round));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe('DELETE /admin/rounds/{id}', () => {
  it('deletes the round with its picks and adjustments', async () => {
    const round = await seedRound();
    const [mom] = await seedPlayers('Mom');
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc1' });
    const res = await deleteRound(request('DELETE', '/x', { token }), at(round));
    expect(res.status).toBe(204);
    expect(await repo.getRound(round.id)).toBeNull();
    expect(await repo.listPicks(round.id)).toEqual([]);
  });

  it('answers 403 with the wrong token and deletes nothing', async () => {
    const round = await seedRound();
    const res = await deleteRound(request('DELETE', '/x', { token: 'wrong' }), at(round));
    expect(res.status).toBe(403);
    expect(await repo.getRound(round.id)).not.toBeNull();
  });
});

describe('team pool endpoints', () => {
  it('adds a manual team from human input', async () => {
    const round = await seedRound();
    for (const [input, key] of [['341b', 'frc341B'], [9999, 'frc9999'], [' frc25 ', 'frc25']] as const) {
      const res = await addTeam(request('POST', '/x', { token, body: { teamNumber: input } }), at(round));
      expect(res.status, String(input)).toBe(201);
      expect((await readJson(res)).teamKey).toBe(key);
    }
    expect((await repo.listExtraTeams(round.id)).sort()).toEqual(['frc25', 'frc341B', 'frc9999']);
  });

  it('answers 400 for junk team numbers', async () => {
    const round = await seedRound();
    for (const teamNumber of ['', '0', '34a1', '123456', 'abc', -5, 3.5, null]) {
      const res = await addTeam(request('POST', '/x', { token, body: { teamNumber } }), at(round));
      expect(res.status, String(teamNumber)).toBe(400);
    }
    expect(await repo.listExtraTeams(round.id)).toEqual([]);
  });

  it('removes a manual team that nobody drafted', async () => {
    const round = await seedRound();
    await repo.addExtraTeam(round.id, 'frc9999');
    const res = await removeTeam(
      request('DELETE', '/x', { token }),
      params({ slug: league.slug, id: round.id, teamKey: 'frc9999' }),
    );
    expect(res.status).toBe(204);
    expect(await repo.listExtraTeams(round.id)).toEqual([]);
  });

  it('answers 409 when removing a team that has been drafted', async () => {
    const round = await seedRound();
    const [mom] = await seedPlayers('Mom');
    await repo.addExtraTeam(round.id, 'frc9999');
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc9999' });
    const res = await removeTeam(
      request('DELETE', '/x', { token }),
      params({ slug: league.slug, id: round.id, teamKey: 'frc9999' }),
    );
    expect(res.status).toBe(409);
    expect(await repo.listExtraTeams(round.id)).toEqual(['frc9999']);
  });

  it('answers 400 for a malformed team key in the URL', async () => {
    const round = await seedRound();
    const res = await removeTeam(
      request('DELETE', '/x', { token }),
      params({ slug: league.slug, id: round.id, teamKey: 'nope' }),
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run tests/api/rounds.test.ts`
Expected: FAIL, cannot resolve the route modules.

- [ ] **Step 4: Implement the pool and the detail builder**

`lib/rounds/pool.ts`:

```ts
import { getRepo } from '@/lib/db';
import type { RoundRow } from '@/lib/db/types';
import { cacheWindowFor } from '@/lib/rounds/status';
import { getTba } from '@/lib/tba/client';
import type { TeamSimple } from '@/lib/tba/types';
import { mergePool, type PoolTeam } from '@/lib/teams';

/** The draftable teams for a round: TBA's list plus the commissioner's manual additions (spec §3.3). */
export async function loadPool(
  round: RoundRow,
  now: Date,
): Promise<{ teams: PoolTeam[]; stale: boolean }> {
  const [tba, extras] = await Promise.all([
    getTba<TeamSimple[]>(`/event/${round.eventKey}/teams/simple`, {
      windowMs: cacheWindowFor(round, now),
    }),
    getRepo().listExtraTeams(round.id),
  ]);
  const tbaTeams = Array.isArray(tba.data) ? tba.data : null;
  return { teams: mergePool(tbaTeams, extras), stale: tba.stale };
}
```

`lib/rounds/detail.ts`:

```ts
import type { AdminRoundDetail } from '@/lib/api/types';
import { getRepo } from '@/lib/db';
import type { RoundRow } from '@/lib/db/types';
import { loadPool } from '@/lib/rounds/pool';
import { roundStatus, shouldNudgeFinalize } from '@/lib/rounds/status';

/** Everything the round admin page needs, in one response. */
export async function roundDetail(round: RoundRow, now: Date): Promise<AdminRoundDetail> {
  const repo = getRepo();
  const [players, picks, adjustments, pool] = await Promise.all([
    repo.listPlayers(round.leagueId),
    repo.listPicks(round.id),
    repo.listAdjustments(round.id),
    loadPool(round, now),
  ]);
  const drafters = round.draftOrder.length;
  return {
    round: {
      id: round.id,
      eventKey: round.eventKey,
      eventName: round.eventName,
      startDate: round.startDate,
      endDate: round.endDate,
      timezone: round.timezone,
      rosterSize: round.rosterSize,
      draftOrder: round.draftOrder,
      scoring: round.scoring,
      finalizedAt: round.finalizedAt,
    },
    status: roundStatus(round, picks.length, now),
    nudgeFinalize: shouldNudgeFinalize(round, now),
    players: players.map((p) => ({ id: p.id, name: p.name })),
    pool: pool.teams,
    poolStale: pool.stale,
    picks: picks.map((p) => ({ pickNumber: p.pickNumber, playerId: p.playerId, teamKey: p.teamKey })),
    adjustments: adjustments.map((a) => ({
      id: a.id,
      playerId: a.playerId,
      teamKey: a.teamKey,
      points: a.points,
      reason: a.reason,
    })),
    maxRosterSize: drafters === 0 ? null : Math.min(10, Math.floor(pool.teams.length / drafters)),
  };
}
```

- [ ] **Step 5: Implement the routes**

`app/api/l/[slug]/admin/rounds/route.ts`:

```ts
import { z } from 'zod';
import { handle, HttpError, json, parseBody, requireCommissioner } from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import { DEFAULT_WINDOW_MS } from '@/lib/rounds/status';
import { getTba } from '@/lib/tba/client';
import type { TbaEvent } from '@/lib/tba/types';
import { normalizeEventKey } from '@/lib/teams';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string }> };

const bodySchema = z.object({
  eventKey: z.string('Event key is required').max(40, 'Event keys look like 2025parr'),
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const body = await parseBody(req, bodySchema);
    const eventKey = normalizeEventKey(body.eventKey);
    if (!eventKey) throw new HttpError(400, 'Event keys look like 2025parr');

    const tba = await getTba<TbaEvent>(`/event/${eventKey}`, { windowMs: DEFAULT_WINDOW_MS });
    const event = tba.data;
    if (!event) {
      if (tba.stale) throw new HttpError(503, "Couldn't reach The Blue Alliance. Try again in a minute.");
      throw new HttpError(404, `The Blue Alliance has no event with the key ${eventKey}`);
    }
    if (!event.name || !DATE_RE.test(event.start_date ?? '') || !DATE_RE.test(event.end_date ?? '')) {
      throw new HttpError(404, `The Blue Alliance has no usable event with the key ${eventKey}`);
    }

    const round = await getRepo().createRound({
      leagueId: league.id,
      eventKey,
      eventName: event.name.slice(0, 200),
      startDate: event.start_date,
      endDate: event.end_date,
      timezone: event.timezone || 'America/New_York',
      scoring: structuredClone(league.defaultScoring), // a copy: later league edits don't touch this round
    });
    return json(
      {
        round: {
          id: round.id,
          eventKey: round.eventKey,
          eventName: round.eventName,
          startDate: round.startDate,
          endDate: round.endDate,
        },
      },
      201,
    );
  });
}
```

`app/api/l/[slug]/admin/rounds/[id]/route.ts`:

```ts
import { z } from 'zod';
import {
  handle,
  HttpError,
  json,
  noContent,
  parseBody,
  requireCommissioner,
  requireRound,
  UUID_RE,
} from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import { roundDetail } from '@/lib/rounds/detail';
import { loadPool } from '@/lib/rounds/pool';
import { scoringConfigSchema } from '@/lib/scoring/config';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string }> };

const patchSchema = z
  .strictObject({
    rosterSize: z
      .number('Roster size must be a whole number from 1 to 10')
      .int('Roster size must be a whole number from 1 to 10')
      .min(1, 'Roster size must be a whole number from 1 to 10')
      .max(10, 'Roster size must be a whole number from 1 to 10')
      .optional(),
    draftOrder: z
      .array(z.string().regex(UUID_RE, 'Draft order must be a list of player ids'))
      .max(50, 'Too many players in the draft order')
      .optional(),
    scoring: scoringConfigSchema.optional(),
    finalized: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change' });

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const round = await requireRound(league, id);
    return json(await roundDetail(round, new Date()));
  });
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const round = await requireRound(league, id);
    const patch = await parseBody(req, patchSchema);
    const repo = getRepo();
    const now = new Date();

    const rosterSize = patch.rosterSize ?? round.rosterSize;
    const draftOrder = patch.draftOrder ?? round.draftOrder;
    const draftChanged =
      rosterSize !== round.rosterSize ||
      draftOrder.length !== round.draftOrder.length ||
      draftOrder.some((playerId, i) => playerId !== round.draftOrder[i]);

    if (draftChanged) {
      const picks = await repo.listPicks(round.id);
      if (picks.length > 0) {
        throw new HttpError(409, 'Undo all picks to change the draft order or roster size');
      }
      if (new Set(draftOrder).size !== draftOrder.length) {
        throw new HttpError(400, 'A player can only appear once in the draft order');
      }
      const playerIds = new Set((await repo.listPlayers(league.id)).map((p) => p.id));
      if (draftOrder.some((playerId) => !playerIds.has(playerId))) {
        throw new HttpError(400, "The draft order includes someone who isn't a player in this league");
      }
      const P = draftOrder.length;
      if (P > 0) {
        const T = (await loadPool(round, now)).teams.length;
        if (P * rosterSize > T) {
          const max = Math.floor(T / P);
          throw new HttpError(
            400,
            max < 1
              ? `There are only ${T} teams for ${P} players. Add teams to the pool first.`
              : `With ${P} players and ${T} teams, roster size can be at most ${max}`,
          );
        }
      }
    }

    const saved = await repo.updateRound(round.id, {
      rosterSize: patch.rosterSize,
      draftOrder: patch.draftOrder,
      scoring: patch.scoring,
      finalizedAt:
        patch.finalized === undefined ? undefined : patch.finalized ? now.toISOString() : null,
    });
    return json(await roundDetail(saved, now));
  });
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const round = await requireRound(league, id);
    await getRepo().deleteRound(round.id);
    return noContent();
  });
}
```

`app/api/l/[slug]/admin/rounds/[id]/teams/route.ts`:

```ts
import { z } from 'zod';
import {
  handle,
  HttpError,
  json,
  parseBody,
  requireCommissioner,
  requireRound,
} from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import { parseTeamInput } from '@/lib/teams';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string; id: string }> };

const BAD_TEAM = 'Team numbers look like 341 or 341B';

const bodySchema = z.object({
  teamNumber: z.union([z.string(BAD_TEAM).max(20, BAD_TEAM), z.number(BAD_TEAM)], BAD_TEAM),
});

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const round = await requireRound(league, id);
    const { teamNumber } = await parseBody(req, bodySchema);
    const teamKey = parseTeamInput(String(teamNumber));
    if (!teamKey) throw new HttpError(400, BAD_TEAM);
    await getRepo().addExtraTeam(round.id, teamKey);
    return json({ teamKey }, 201);
  });
}
```

`app/api/l/[slug]/admin/rounds/[id]/teams/[teamKey]/route.ts`:

```ts
import { handle, HttpError, noContent, requireCommissioner, requireRound } from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import { isTeamKey } from '@/lib/teams';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string; id: string; teamKey: string }> };

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id, teamKey } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const round = await requireRound(league, id);
    if (!isTeamKey(teamKey)) throw new HttpError(400, 'That is not a team key');
    const repo = getRepo();
    const picks = await repo.listPicks(round.id);
    if (picks.some((p) => p.teamKey === teamKey)) {
      throw new HttpError(409, 'That team has been drafted. Undo or replace the pick first.');
    }
    await repo.removeExtraTeam(round.id, teamKey);
    return noContent();
  });
}
```

- [ ] **Step 6: Run it and watch it pass**

Run: `npx vitest run tests/api/rounds.test.ts && npm run typecheck`
Expected: PASS; typecheck prints nothing.

- [ ] **Step 7: Commit**

```bash
git add lib/rounds lib/api/types.ts "app/api/l/[slug]/admin/rounds" tests/api/rounds.test.ts
git commit -m "feat: round endpoints and team pool"
```

---

### Task 19: Draft pick endpoints

**Files:**
- Create: `app/api/l/[slug]/admin/rounds/[id]/picks/route.ts`
- Create: `app/api/l/[slug]/admin/rounds/[id]/picks/[pickNumber]/route.ts`
- Test: `tests/api/picks.test.ts`

**Interfaces:**
- Consumes: `pickerFor` (Task 9); `loadPool` (Task 18); `isTeamKey` (Task 3); everything from Task 15; `getRepo`.
- Produces:
  - `POST /api/l/{slug}/admin/rounds/{id}/picks` body `{ expectedPickNumber, teamKey }` → 201 `{ pick: { pickNumber, playerId, teamKey } }`; 400 team not in pool; 409 stale pick number / team taken / draft full / no draft order
  - `DELETE /api/l/{slug}/admin/rounds/{id}/picks/{pickNumber}` → 204; 409 not the last pick
  - `PATCH /api/l/{slug}/admin/rounds/{id}/picks/{pickNumber}` body `{ teamKey }` → 200 `{ pick }`; 400 not in pool; 404 no such pick; 409 team taken

- [ ] **Step 1: Write the failing test**

`tests/api/picks.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import {
  DELETE as undoPick,
  PATCH as replacePick,
} from '@/app/api/l/[slug]/admin/rounds/[id]/picks/[pickNumber]/route';
import { POST as addPick } from '@/app/api/l/[slug]/admin/rounds/[id]/picks/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, PlayerRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;
let token: string;
let round: RoundRow;
let mom: PlayerRow;
let dad: PlayerRow;

const TBA_TEAMS = [1, 2, 3, 4, 5, 6].map((n) => ({ key: `frc${n}`, team_number: n, nickname: `Team ${n}` }));

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  h.getTba = vi.fn(async () => ({ data: TBA_TEAMS, fetchedAt: '2026-10-01T12:00:00.000Z', stale: false }));
  ({ league, token } = await seedLeague(repo));
  mom = await repo.createPlayer(league.id, 'Mom');
  dad = await repo.createPlayer(league.id, 'Dad');
  round = await repo.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
    scoring: defaultScoring(),
  });
  round = await repo.updateRound(round.id, { draftOrder: [mom.id, dad.id], rosterSize: 2 });
});

const here = () => params({ slug: league.slug, id: round.id });
const atPick = (pickNumber: number | string) =>
  params({ slug: league.slug, id: round.id, pickNumber: String(pickNumber) });

function pick(expectedPickNumber: number, teamKey: string, t: string | undefined = token) {
  return addPick(request('POST', '/x', { token: t, body: { expectedPickNumber, teamKey } }), here());
}

describe('POST picks', () => {
  it('records picks in snake order: Mom, Dad, Dad, Mom', async () => {
    const teams = ['frc1', 'frc2', 'frc3', 'frc4'];
    for (let n = 0; n < teams.length; n++) {
      const res = await pick(n, teams[n]);
      expect(res.status, `pick ${n}`).toBe(201);
    }
    const saved = await repo.listPicks(round.id);
    expect(saved.map((p) => [p.pickNumber, p.playerId, p.teamKey])).toEqual([
      [0, mom.id, 'frc1'],
      [1, dad.id, 'frc2'],
      [2, dad.id, 'frc3'],
      [3, mom.id, 'frc4'],
    ]);
  });

  it('returns the pick it recorded', async () => {
    const res = await pick(0, 'frc1');
    expect(await readJson(res)).toEqual({ pick: { pickNumber: 0, playerId: mom.id, teamKey: 'frc1' } });
  });

  it('answers 409 for the wrong expected pick number', async () => {
    await pick(0, 'frc1');
    for (const n of [0, 2]) {
      const res = await pick(n, 'frc2');
      expect(res.status, `expected ${n}`).toBe(409);
      expect((await readJson(res)).error).toBe('Draft changed in another tab — refresh');
    }
    expect(await repo.listPicks(round.id)).toHaveLength(1);
  });

  it('answers 409 when the team is already taken', async () => {
    await pick(0, 'frc1');
    const res = await pick(1, 'frc1');
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('That team was just taken');
  });

  it('answers 409 when two tabs pick at the same moment (race)', async () => {
    // Both requests read "no picks yet", then both try to insert pick 0.
    vi.spyOn(repo, 'listPicks').mockResolvedValue([]);
    expect((await pick(0, 'frc1')).status).toBe(201);
    const second = await pick(0, 'frc2');
    expect(second.status).toBe(409);
    expect((await readJson(second)).error).toBe('Draft changed in another tab — refresh');
  });

  it('answers 409 when the draft is full', async () => {
    const teams = ['frc1', 'frc2', 'frc3', 'frc4'];
    for (let n = 0; n < teams.length; n++) await pick(n, teams[n]);
    const res = await pick(4, 'frc5');
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('The draft is full');
  });

  it('answers 409 when there is no draft order yet', async () => {
    await repo.updateRound(round.id, { draftOrder: [] });
    const res = await pick(0, 'frc1');
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toMatch(/draft order/i);
  });

  it('answers 400 for a team that is not in the pool', async () => {
    const res = await pick(0, 'frc9999');
    expect(res.status).toBe(400);
    expect(await repo.listPicks(round.id)).toEqual([]);
  });

  it('accepts a manually added team', async () => {
    await repo.addExtraTeam(round.id, 'frc341B');
    expect((await pick(0, 'frc341B')).status).toBe(201);
  });

  it('answers 400 for malformed input', async () => {
    const bodies = [
      { expectedPickNumber: 0, teamKey: '341' },
      { expectedPickNumber: -1, teamKey: 'frc1' },
      { expectedPickNumber: 0.5, teamKey: 'frc1' },
      { teamKey: 'frc1' },
      { expectedPickNumber: 0 },
    ];
    for (const body of bodies) {
      const res = await addPick(request('POST', '/x', { token, body }), here());
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('answers 403 with a missing or wrong token', async () => {
    const res = await addPick(
      request('POST', '/x', { body: { expectedPickNumber: 0, teamKey: 'frc1' } }),
      here(),
    );
    expect(res.status).toBe(403);
    expect((await pick(0, 'frc1', 'wrong')).status).toBe(403);
    expect(await repo.listPicks(round.id)).toEqual([]);
  });

  it("answers 404 when league A's token is used on league B's round", async () => {
    const other = await seedLeague(repo, { slug: 'other-league-bbbbbb' });
    const res = await addPick(
      request('POST', '/x', { token: other.token, body: { expectedPickNumber: 0, teamKey: 'frc1' } }),
      params({ slug: other.league.slug, id: round.id }),
    );
    expect(res.status).toBe(404);
    expect(await repo.listPicks(round.id)).toEqual([]);
  });
});

describe('DELETE picks/{pickNumber} (undo)', () => {
  it('undoes the last pick', async () => {
    await pick(0, 'frc1');
    await pick(1, 'frc2');
    const res = await undoPick(request('DELETE', '/x', { token }), atPick(1));
    expect(res.status).toBe(204);
    expect((await repo.listPicks(round.id)).map((p) => p.teamKey)).toEqual(['frc1']);
  });

  it('frees the team to be picked again', async () => {
    await pick(0, 'frc1');
    await undoPick(request('DELETE', '/x', { token }), atPick(0));
    expect((await pick(0, 'frc1')).status).toBe(201);
  });

  it('answers 409 for any pick that is not the last one', async () => {
    await pick(0, 'frc1');
    await pick(1, 'frc2');
    for (const n of [0, 2, 'abc', '-1', '1.5']) {
      const res = await undoPick(request('DELETE', '/x', { token }), atPick(n));
      expect(res.status, String(n)).toBe(409);
    }
    expect(await repo.listPicks(round.id)).toHaveLength(2);
  });

  it('answers 409 when there is nothing to undo', async () => {
    const res = await undoPick(request('DELETE', '/x', { token }), atPick(0));
    expect(res.status).toBe(409);
  });
});

describe('PATCH picks/{pickNumber} (replace)', () => {
  it('changes the team without changing the order or the player', async () => {
    await pick(0, 'frc1');
    await pick(1, 'frc2');
    const res = await replacePick(request('PATCH', '/x', { token, body: { teamKey: 'frc6' } }), atPick(0));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ pick: { pickNumber: 0, playerId: mom.id, teamKey: 'frc6' } });
    expect((await repo.listPicks(round.id)).map((p) => [p.pickNumber, p.playerId, p.teamKey])).toEqual([
      [0, mom.id, 'frc6'],
      [1, dad.id, 'frc2'],
    ]);
  });

  it('answers 409 when the new team is taken', async () => {
    await pick(0, 'frc1');
    await pick(1, 'frc2');
    const res = await replacePick(request('PATCH', '/x', { token, body: { teamKey: 'frc2' } }), atPick(0));
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('That team was just taken');
  });

  it('is a harmless no-op when the team is unchanged', async () => {
    await pick(0, 'frc1');
    const res = await replacePick(request('PATCH', '/x', { token, body: { teamKey: 'frc1' } }), atPick(0));
    expect(res.status).toBe(200);
  });

  it('answers 400 for a team outside the pool', async () => {
    await pick(0, 'frc1');
    const res = await replacePick(request('PATCH', '/x', { token, body: { teamKey: 'frc9999' } }), atPick(0));
    expect(res.status).toBe(400);
  });

  it('answers 404 for a pick that does not exist', async () => {
    for (const n of [0, 'abc']) {
      const res = await replacePick(request('PATCH', '/x', { token, body: { teamKey: 'frc1' } }), atPick(n));
      expect(res.status, String(n)).toBe(404);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/api/picks.test.ts`
Expected: FAIL, cannot resolve the route modules.

- [ ] **Step 3: Implement**

`app/api/l/[slug]/admin/rounds/[id]/picks/route.ts`:

```ts
import { z } from 'zod';
import {
  handle,
  HttpError,
  json,
  parseBody,
  requireCommissioner,
  requireRound,
} from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import { loadPool } from '@/lib/rounds/pool';
import { pickerFor } from '@/lib/scoring/round';
import { TEAM_KEY_RE } from '@/lib/teams';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string }> };

const bodySchema = z.object({
  expectedPickNumber: z
    .number('expectedPickNumber must be a whole number, 0 or more')
    .int('expectedPickNumber must be a whole number, 0 or more')
    .min(0, 'expectedPickNumber must be a whole number, 0 or more'),
  teamKey: z.string('teamKey is required').regex(TEAM_KEY_RE, 'Team keys look like frc341'),
});

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const round = await requireRound(league, id);
    const { expectedPickNumber, teamKey } = await parseBody(req, bodySchema);
    const repo = getRepo();

    if (round.draftOrder.length === 0) {
      throw new HttpError(409, 'Set the draft order before drafting');
    }
    const picks = await repo.listPicks(round.id);
    if (expectedPickNumber !== picks.length) {
      throw new HttpError(409, 'Draft changed in another tab — refresh');
    }
    if (picks.length >= round.draftOrder.length * round.rosterSize) {
      throw new HttpError(409, 'The draft is full');
    }
    const pool = await loadPool(round, new Date());
    if (!pool.teams.some((t) => t.teamKey === teamKey)) {
      throw new HttpError(400, "That team isn't in this event's team pool");
    }

    // The database's unique constraints are the real guard against two tabs picking at once.
    // If one fires, handle() turns it into the matching 409.
    const saved = await repo.insertPick({
      roundId: round.id,
      pickNumber: expectedPickNumber,
      playerId: pickerFor(expectedPickNumber, round.draftOrder),
      teamKey,
    });
    return json(
      { pick: { pickNumber: saved.pickNumber, playerId: saved.playerId, teamKey: saved.teamKey } },
      201,
    );
  });
}
```

`app/api/l/[slug]/admin/rounds/[id]/picks/[pickNumber]/route.ts`:

```ts
import { z } from 'zod';
import {
  handle,
  HttpError,
  json,
  noContent,
  parseBody,
  requireCommissioner,
  requireRound,
} from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import { loadPool } from '@/lib/rounds/pool';
import { TEAM_KEY_RE } from '@/lib/teams';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string; pickNumber: string }> };

const bodySchema = z.object({
  teamKey: z.string('teamKey is required').regex(TEAM_KEY_RE, 'Team keys look like frc341'),
});

/** "7" -> 7. Anything that isn't a plain whole number -> null. */
function parsePickNumber(raw: string): number | null {
  return /^(0|[1-9][0-9]{0,4})$/.test(raw) ? Number(raw) : null;
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id, pickNumber } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const round = await requireRound(league, id);
    const repo = getRepo();
    const picks = await repo.listPicks(round.id);
    const n = parsePickNumber(pickNumber);
    if (n === null || picks.length === 0 || n !== picks.length - 1) {
      throw new HttpError(409, 'Only the last pick can be undone — refresh');
    }
    await repo.deletePick(round.id, n);
    return noContent();
  });
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id, pickNumber } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const round = await requireRound(league, id);
    const { teamKey } = await parseBody(req, bodySchema);
    const repo = getRepo();

    const n = parsePickNumber(pickNumber);
    const existing = n === null ? undefined : (await repo.listPicks(round.id)).find((p) => p.pickNumber === n);
    if (n === null || !existing) throw new HttpError(404, 'Pick not found');

    const pool = await loadPool(round, new Date());
    if (!pool.teams.some((t) => t.teamKey === teamKey)) {
      throw new HttpError(400, "That team isn't in this event's team pool");
    }

    const saved =
      existing.teamKey === teamKey ? existing : await repo.updatePickTeam(round.id, n, teamKey);
    return json({
      pick: { pickNumber: saved.pickNumber, playerId: saved.playerId, teamKey: saved.teamKey },
    });
  });
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/api/picks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/l/[slug]/admin/rounds/[id]/picks" tests/api/picks.test.ts
git commit -m "feat: draft pick endpoints (add, undo, replace)"
```

---

### Task 20: Adjustment endpoints and "Refresh from TBA"

**Files:**
- Create: `lib/api/adjustments.ts`
- Create: `app/api/l/[slug]/admin/rounds/[id]/adjustments/route.ts`
- Create: `app/api/l/[slug]/admin/rounds/[id]/adjustments/[adjId]/route.ts`
- Create: `app/api/l/[slug]/admin/rounds/[id]/refresh/route.ts`
- Test: `tests/api/adjustments.test.ts`, `tests/api/refresh.test.ts`

**Interfaces:**
- Consumes: everything from Task 15; `getRepo`; `TEAM_KEY_RE` (Task 3); `loadEventData` (Task 13); `cacheWindowFor` (Task 10).
- Produces:
  - From `@/lib/api/adjustments`: `pointsField`, `reasonField`, `playerIdField`, `teamKeyField` (zod schemas), `assertLeaguePlayer(leagueId: string, playerId: string): Promise<void>`, `type AdjustmentJson = { id; playerId; teamKey; points; reason }`, `toJson(row: AdjustmentRow): AdjustmentJson`
  - `POST /api/l/{slug}/admin/rounds/{id}/adjustments` body `{ playerId?, teamKey?, points, reason }` → 201 `{ adjustment: AdjustmentJson }`; 400
  - `PATCH /api/l/{slug}/admin/rounds/{id}/adjustments/{adjId}` body: any subset of the same fields → 200 `{ adjustment }`; 400; 404
  - `DELETE /api/l/{slug}/admin/rounds/{id}/adjustments/{adjId}` → 204; 404
  - `POST /api/l/{slug}/admin/rounds/{id}/refresh` → 200 `{ fetchedAt: string | null, stale: boolean }`

- [ ] **Step 1: Write the failing adjustments test**

`tests/api/adjustments.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import {
  DELETE as deleteAdjustment,
  PATCH as patchAdjustment,
} from '@/app/api/l/[slug]/admin/rounds/[id]/adjustments/[adjId]/route';
import { POST as addAdjustment } from '@/app/api/l/[slug]/admin/rounds/[id]/adjustments/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, PlayerRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;
let token: string;
let round: RoundRow;
let mom: PlayerRow;

async function newRound(leagueId: string, eventKey = '2025parr') {
  return repo.createRound({
    leagueId, eventKey, eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
    scoring: defaultScoring(),
  });
}

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  ({ league, token } = await seedLeague(repo));
  mom = await repo.createPlayer(league.id, 'Mom');
  round = await newRound(league.id);
});

const here = () => params({ slug: league.slug, id: round.id });
const atAdj = (adjId: string) => params({ slug: league.slug, id: round.id, adjId });
const add = (body: unknown) => addAdjustment(request('POST', '/x', { token, body }), here());

describe('POST adjustments (§3.7)', () => {
  it('adds a team-targeted adjustment', async () => {
    const res = await add({ teamKey: 'frc341', points: 5, reason: '  Industrial Design Award ' });
    expect(res.status).toBe(201);
    const { adjustment } = await readJson(res);
    expect(adjustment).toMatchObject({
      playerId: null, teamKey: 'frc341', points: 5, reason: 'Industrial Design Award',
    });
    expect(await repo.listAdjustments(round.id)).toHaveLength(1);
  });

  it('adds a player-targeted adjustment, which may be negative', async () => {
    const res = await add({ playerId: mom.id, points: -10, reason: 'Late to the draft' });
    expect(res.status).toBe(201);
    expect((await readJson(res)).adjustment).toMatchObject({ playerId: mom.id, teamKey: null, points: -10 });
  });

  it('accepts a team nobody has drafted', async () => {
    expect((await add({ teamKey: 'frc9999', points: 5, reason: 'Spirit' })).status).toBe(201);
  });

  it('accepts a player who is not in the draft order (Deviation 2)', async () => {
    const gran = await repo.createPlayer(league.id, 'Gran');
    expect((await add({ playerId: gran.id, points: 7, reason: 'Guessed the winner' })).status).toBe(201);
  });

  it('answers 400 unless exactly one target is given', async () => {
    const bodies = [
      { points: 5, reason: 'x' },
      { playerId: mom.id, teamKey: 'frc341', points: 5, reason: 'x' },
      { playerId: null, teamKey: null, points: 5, reason: 'x' },
    ];
    for (const body of bodies) {
      const res = await add(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await readJson(res)).error).toBe('Choose one target: a player or a team');
    }
  });

  it("answers 400 for a player from another league or one that doesn't exist", async () => {
    const other = await seedLeague(repo, { slug: 'other-league-bbbbbb' });
    const stranger = await repo.createPlayer(other.league.id, 'Stranger');
    for (const playerId of [stranger.id, '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b']) {
      const res = await add({ playerId, points: 5, reason: 'x' });
      expect(res.status).toBe(400);
    }
  });

  it('answers 400 for bad points, reason, or team key', async () => {
    const bodies = [
      { teamKey: 'frc341', points: 1.5, reason: 'x' },
      { teamKey: 'frc341', points: 1001, reason: 'x' },
      { teamKey: 'frc341', points: -1001, reason: 'x' },
      { teamKey: 'frc341', points: '5', reason: 'x' },
      { teamKey: 'frc341', points: 5, reason: '' },
      { teamKey: 'frc341', points: 5, reason: '   ' },
      { teamKey: 'frc341', points: 5, reason: 'x'.repeat(201) },
      { teamKey: 'frc341', points: 5 },
      { teamKey: '341', points: 5, reason: 'x' },
      { playerId: 'not-a-uuid', points: 5, reason: 'x' },
    ];
    for (const body of bodies) {
      expect((await add(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await repo.listAdjustments(round.id)).toEqual([]);
  });

  it('accepts a reason of exactly 200 characters and points at the limits', async () => {
    expect((await add({ teamKey: 'frc341', points: 1000, reason: 'x'.repeat(200) })).status).toBe(201);
    expect((await add({ teamKey: 'frc341', points: -1000, reason: 'y' })).status).toBe(201);
  });

  it('answers 403 without a token', async () => {
    const res = await addAdjustment(
      request('POST', '/x', { body: { teamKey: 'frc341', points: 5, reason: 'x' } }),
      here(),
    );
    expect(res.status).toBe(403);
  });
});

describe('PATCH adjustments/{adjId}', () => {
  async function seeded() {
    return repo.insertAdjustment({
      roundId: round.id, playerId: null, teamKey: 'frc341', points: 5, reason: 'Award',
    });
  }

  it('changes only the fields that were sent', async () => {
    const adj = await seeded();
    const res = await patchAdjustment(request('PATCH', '/x', { token, body: { points: 8 } }), atAdj(adj.id));
    expect(res.status).toBe(200);
    expect((await readJson(res)).adjustment).toMatchObject({
      id: adj.id, teamKey: 'frc341', playerId: null, points: 8, reason: 'Award',
    });
  });

  it('switches the target from a team to a player', async () => {
    const adj = await seeded();
    const res = await patchAdjustment(
      request('PATCH', '/x', { token, body: { playerId: mom.id } }),
      atAdj(adj.id),
    );
    expect(res.status).toBe(200);
    expect(await repo.getAdjustment(adj.id)).toMatchObject({ playerId: mom.id, teamKey: null });
  });

  it('switches the target from a player to a team', async () => {
    const adj = await repo.insertAdjustment({
      roundId: round.id, playerId: mom.id, teamKey: null, points: 5, reason: 'x',
    });
    await patchAdjustment(request('PATCH', '/x', { token, body: { teamKey: 'frc25' } }), atAdj(adj.id));
    expect(await repo.getAdjustment(adj.id)).toMatchObject({ playerId: null, teamKey: 'frc25' });
  });

  it('answers 400 for both targets, bad values, unknown fields, or an empty patch', async () => {
    const adj = await seeded();
    const bodies = [
      { playerId: mom.id, teamKey: 'frc25' },
      { points: 1001 },
      { reason: '' },
      { roundId: 'x' },
      {},
    ];
    for (const body of bodies) {
      const res = await patchAdjustment(request('PATCH', '/x', { token, body }), atAdj(adj.id));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await repo.getAdjustment(adj.id)).toMatchObject({ teamKey: 'frc341', points: 5, reason: 'Award' });
  });

  it("answers 404 for an unknown id, a bad id, or another round's adjustment", async () => {
    const otherRound = await newRound(league.id, '2026parr');
    const elsewhere = await repo.insertAdjustment({
      roundId: otherRound.id, playerId: null, teamKey: 'frc1', points: 1, reason: 'x',
    });
    for (const id of ['3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b', 'nope', elsewhere.id]) {
      const res = await patchAdjustment(request('PATCH', '/x', { token, body: { points: 9 } }), atAdj(id));
      expect(res.status, id).toBe(404);
    }
    expect((await repo.getAdjustment(elsewhere.id))!.points).toBe(1);
  });
});

describe('DELETE adjustments/{adjId}', () => {
  it('deletes the adjustment', async () => {
    const adj = await repo.insertAdjustment({
      roundId: round.id, playerId: null, teamKey: 'frc341', points: 5, reason: 'Award',
    });
    const res = await deleteAdjustment(request('DELETE', '/x', { token }), atAdj(adj.id));
    expect(res.status).toBe(204);
    expect(await repo.listAdjustments(round.id)).toEqual([]);
  });

  it('answers 404 for an unknown id', async () => {
    const res = await deleteAdjustment(
      request('DELETE', '/x', { token }),
      atAdj('3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b'),
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Write the failing refresh test**

`tests/api/refresh.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import { POST as refresh } from '@/app/api/l/[slug]/admin/rounds/[id]/refresh/route';
import type { Repo } from '@/lib/db/repo';
import { defaultScoring } from '@/lib/scoring/config';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;

beforeEach(() => {
  repo = createMemoryRepo();
  h.repo = repo;
  h.getTba = vi.fn(async () => ({ data: null, fetchedAt: '2026-10-24T18:00:00.000Z', stale: false }));
});

async function setup() {
  const { league, token } = await seedLeague(repo);
  const round = await repo.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
    scoring: defaultScoring(),
  });
  return { league, token, round };
}

describe('POST refresh (§5.5, §8.3)', () => {
  it('forces a refresh of all six event endpoints', async () => {
    const { league, token, round } = await setup();
    const res = await refresh(request('POST', '/x', { token }), params({ slug: league.slug, id: round.id }));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ fetchedAt: '2026-10-24T18:00:00.000Z', stale: false });

    const calls = (h.getTba as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => c[0]).sort()).toEqual([
      '/event/2025parr/alliances',
      '/event/2025parr/awards',
      '/event/2025parr/matches/simple',
      '/event/2025parr/oprs',
      '/event/2025parr/rankings',
      '/event/2025parr/teams/simple',
    ]);
    for (const call of calls) expect(call[1]).toMatchObject({ force: true });
  });

  it('still answers 200 when TBA is down, and says the data is stale', async () => {
    h.getTba = vi.fn(async () => ({ data: null, fetchedAt: '2026-10-24T17:00:00.000Z', stale: true }));
    const { league, token, round } = await setup();
    const res = await refresh(request('POST', '/x', { token }), params({ slug: league.slug, id: round.id }));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ fetchedAt: '2026-10-24T17:00:00.000Z', stale: true });
  });

  it('answers 403 without a token and does not call TBA', async () => {
    const { league, round } = await setup();
    const res = await refresh(request('POST', '/x'), params({ slug: league.slug, id: round.id }));
    expect(res.status).toBe(403);
    expect(h.getTba).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run tests/api/adjustments.test.ts tests/api/refresh.test.ts`
Expected: FAIL, cannot resolve the route modules.

- [ ] **Step 4: Implement**

`lib/api/adjustments.ts`:

```ts
import { z } from 'zod';
import { HttpError, UUID_RE } from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import type { AdjustmentRow } from '@/lib/db/types';
import { TEAM_KEY_RE } from '@/lib/teams';

const POINTS_MESSAGE = 'Points must be a whole number from -1000 to 1000';

export const pointsField = z
  .number(POINTS_MESSAGE)
  .int(POINTS_MESSAGE)
  .min(-1000, POINTS_MESSAGE)
  .max(1000, POINTS_MESSAGE);

export const reasonField = z
  .string('A reason is required')
  .trim()
  .min(1, 'A reason is required')
  .max(200, 'The reason must be 200 characters or fewer');

export const playerIdField = z.string('Unknown player').regex(UUID_RE, 'Unknown player');

export const teamKeyField = z
  .string('Team keys look like frc341')
  .regex(TEAM_KEY_RE, 'Team keys look like frc341');

export const ONE_TARGET = 'Choose one target: a player or a team';

export async function assertLeaguePlayer(leagueId: string, playerId: string): Promise<void> {
  const players = await getRepo().listPlayers(leagueId);
  if (!players.some((p) => p.id === playerId)) throw new HttpError(400, 'Unknown player');
}

export type AdjustmentJson = {
  id: string;
  playerId: string | null;
  teamKey: string | null;
  points: number;
  reason: string;
};

export function toJson(row: AdjustmentRow): AdjustmentJson {
  return {
    id: row.id,
    playerId: row.playerId,
    teamKey: row.teamKey,
    points: row.points,
    reason: row.reason,
  };
}
```

`app/api/l/[slug]/admin/rounds/[id]/adjustments/route.ts`:

```ts
import { z } from 'zod';
import {
  assertLeaguePlayer,
  ONE_TARGET,
  playerIdField,
  pointsField,
  reasonField,
  teamKeyField,
  toJson,
} from '@/lib/api/adjustments';
import {
  handle,
  HttpError,
  json,
  parseBody,
  requireCommissioner,
  requireRound,
} from '@/lib/api/http';
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string; id: string }> };

const bodySchema = z.strictObject({
  playerId: playerIdField.nullish(),
  teamKey: teamKeyField.nullish(),
  points: pointsField,
  reason: reasonField,
});

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const round = await requireRound(league, id);
    const body = await parseBody(req, bodySchema);

    const playerId = body.playerId ?? null;
    const teamKey = body.teamKey ?? null;
    if ((playerId === null) === (teamKey === null)) throw new HttpError(400, ONE_TARGET);
    if (playerId) await assertLeaguePlayer(league.id, playerId);

    const saved = await getRepo().insertAdjustment({
      roundId: round.id,
      playerId,
      teamKey,
      points: body.points,
      reason: body.reason,
    });
    return json({ adjustment: toJson(saved) }, 201);
  });
}
```

`app/api/l/[slug]/admin/rounds/[id]/adjustments/[adjId]/route.ts`:

```ts
import { z } from 'zod';
import {
  assertLeaguePlayer,
  playerIdField,
  pointsField,
  reasonField,
  teamKeyField,
  toJson,
} from '@/lib/api/adjustments';
import {
  handle,
  HttpError,
  isUuid,
  json,
  noContent,
  parseBody,
  requireCommissioner,
  requireRound,
} from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import type { AdjustmentRow, RoundRow } from '@/lib/db/types';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string; id: string; adjId: string }> };

const patchSchema = z
  .strictObject({
    playerId: playerIdField.optional(),
    teamKey: teamKeyField.optional(),
    points: pointsField.optional(),
    reason: reasonField.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change' })
  .refine((v) => !(v.playerId !== undefined && v.teamKey !== undefined), {
    message: 'Choose one target: a player or a team',
  });

async function requireAdjustment(round: RoundRow, adjId: string): Promise<AdjustmentRow> {
  if (!isUuid(adjId)) throw new HttpError(404, 'Adjustment not found');
  const adjustment = await getRepo().getAdjustment(adjId);
  if (!adjustment || adjustment.roundId !== round.id) throw new HttpError(404, 'Adjustment not found');
  return adjustment;
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id, adjId } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const round = await requireRound(league, id);
    const existing = await requireAdjustment(round, adjId);
    const patch = await parseBody(req, patchSchema);

    // Naming a new target clears the other one, so there is always exactly one.
    let playerId = existing.playerId;
    let teamKey = existing.teamKey;
    if (patch.playerId !== undefined) {
      await assertLeaguePlayer(league.id, patch.playerId);
      playerId = patch.playerId;
      teamKey = null;
    } else if (patch.teamKey !== undefined) {
      teamKey = patch.teamKey;
      playerId = null;
    }

    const saved = await getRepo().updateAdjustment(existing.id, {
      playerId,
      teamKey,
      points: patch.points,
      reason: patch.reason,
    });
    return json({ adjustment: toJson(saved) });
  });
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id, adjId } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const round = await requireRound(league, id);
    const existing = await requireAdjustment(round, adjId);
    await getRepo().deleteAdjustment(existing.id);
    return noContent();
  });
}
```

`app/api/l/[slug]/admin/rounds/[id]/refresh/route.ts`:

```ts
import { handle, json, requireCommissioner, requireRound } from '@/lib/api/http';
import { cacheWindowFor } from '@/lib/rounds/status';
import { loadEventData } from '@/lib/tba/event';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const round = await requireRound(league, id);
    // getTba ignores force for rows under 15 s old, which is the rate limit (spec §8.3).
    const loaded = await loadEventData(round.eventKey, {
      windowMs: cacheWindowFor(round, new Date()),
      force: true,
    });
    return json({ fetchedAt: loaded.fetchedAt, stale: loaded.stale });
  });
}
```

- [ ] **Step 5: Run them and watch them pass**

Run: `npx vitest run tests/api && npm run typecheck`
Expected: every API test passes; typecheck prints nothing.

- [ ] **Step 6: Commit**

```bash
git add lib/api/adjustments.ts "app/api/l/[slug]/admin/rounds/[id]/adjustments" "app/api/l/[slug]/admin/rounds/[id]/refresh" tests/api/adjustments.test.ts tests/api/refresh.test.ts
git commit -m "feat: adjustment endpoints and TBA refresh"
```

---

### Task 21: Lost admin link recovery script

**Files:**
- Create: `lib/auth/rotate.ts`
- Create: `scripts/rotate-admin-token.ts`
- Test: `tests/auth/rotate.test.ts`

**Interfaces:**
- Consumes: `generateAdminToken`, `hashToken`, `verifyToken` (Task 14); `Repo` (Task 12); `createSupabaseClient`, `createSupabaseRepo` (Task 12).
- Produces:
  - `rotateAdminToken(repo: Repo, slug: string): Promise<{ slug: string; name: string; token: string }>` — throws `Error` for an unknown slug
  - `adminLink(origin: string, slug: string, token: string): string`
  - CLI: `npx tsx --env-file=.env.local scripts/rotate-admin-token.ts <slug> [site-url]`

- [ ] **Step 1: Write the failing test**

`tests/auth/rotate.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { verifyToken } from '@/lib/auth/commissioner';
import { adminLink, rotateAdminToken } from '@/lib/auth/rotate';
import type { Repo } from '@/lib/db/repo';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;

beforeEach(() => {
  repo = createMemoryRepo();
});

describe('rotateAdminToken', () => {
  it('replaces the token: the new one works and the old one stops working', async () => {
    const { league, token: oldToken } = await seedLeague(repo);
    const out = await rotateAdminToken(repo, league.slug);
    expect(out).toMatchObject({ slug: league.slug, name: 'Habich Fam' });
    expect(out.token).not.toBe(oldToken);

    const saved = (await repo.getLeagueBySlug(league.slug))!;
    expect(verifyToken(out.token, saved.adminTokenHash)).toBe(true);
    expect(verifyToken(oldToken, saved.adminTokenHash)).toBe(false);
  });

  it('changes nothing else about the league', async () => {
    const { league } = await seedLeague(repo);
    await rotateAdminToken(repo, league.slug);
    const saved = (await repo.getLeagueBySlug(league.slug))!;
    expect(saved).toMatchObject({ id: league.id, name: league.name, defaultScoring: league.defaultScoring });
  });

  it('throws for an unknown league', async () => {
    await expect(rotateAdminToken(repo, 'no-such-league')).rejects.toThrow(/no league/i);
  });
});

describe('adminLink', () => {
  it('puts the token in the URL fragment', () => {
    expect(adminLink('https://frc-fantasy.vercel.app', 'habich-fam-abc234', 'TOKEN')).toBe(
      'https://frc-fantasy.vercel.app/l/habich-fam-abc234/admin#k=TOKEN',
    );
  });
  it('tolerates a trailing slash on the site URL', () => {
    expect(adminLink('http://localhost:3000/', 's', 't')).toBe('http://localhost:3000/l/s/admin#k=t');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/auth/rotate.test.ts`
Expected: FAIL, cannot resolve `@/lib/auth/rotate`.

- [ ] **Step 3: Implement**

`lib/auth/rotate.ts`:

```ts
import { generateAdminToken, hashToken } from '@/lib/auth/commissioner';
import type { Repo } from '@/lib/db/repo';

export function adminLink(origin: string, slug: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/l/${slug}/admin#k=${token}`;
}

/** Issues a new admin token for a league. The old admin link stops working immediately. */
export async function rotateAdminToken(
  repo: Repo,
  slug: string,
): Promise<{ slug: string; name: string; token: string }> {
  const league = await repo.getLeagueBySlug(slug);
  if (!league) throw new Error(`No league with the slug "${slug}"`);
  const token = generateAdminToken();
  await repo.updateLeague(league.id, { adminTokenHash: hashToken(token) });
  return { slug: league.slug, name: league.name, token };
}
```

`scripts/rotate-admin-token.ts`:

```ts
// Makes a new admin link for a league when the old one is lost (spec §4).
// Usage: npx tsx --env-file=.env.local scripts/rotate-admin-token.ts <slug> [site-url]
import { adminLink, rotateAdminToken } from '@/lib/auth/rotate';
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';

async function main() {
  const slug = (process.argv[2] ?? '').trim();
  const origin = (process.argv[3] ?? 'http://localhost:3000').trim();
  if (!slug) {
    throw new Error('Usage: rotate-admin-token.ts <slug> [site-url]\n  e.g. rotate-admin-token.ts habich-fam-k3x9qd https://frc-fantasy.vercel.app');
  }
  const repo = createSupabaseRepo(createSupabaseClient());
  const out = await rotateAdminToken(repo, slug);
  console.log(`New admin link for "${out.name}":\n`);
  console.log(`  ${adminLink(origin, out.slug, out.token)}\n`);
  console.log('Save it now. The old admin link no longer works.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/auth`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm test && npm run typecheck && npm run build
git add lib/auth/rotate.ts scripts/rotate-admin-token.ts tests/auth/rotate.test.ts
git commit -m "feat: admin token rotation script"
```

Expected: all tests pass, and `next build` lists every `/api/...` route as dynamic (the `ƒ` symbol), none as static (`○`).

**Part 2 is done when:** `npm test` is green, `scripts/db-smoke.ts` prints all `ok` against the real database, and the build shows every API route as dynamic. Go to Part 3.
