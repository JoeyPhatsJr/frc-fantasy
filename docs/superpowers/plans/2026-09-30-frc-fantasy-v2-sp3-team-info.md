# FRC Fantasy v2 — SP3 Team Info Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache computed event scores in a derived `event_scores` table, build a `team_stats` table (projected fantasy points, past results, latest OPR/rank), and show those stats in the draft pool, so non-experts can draft sensibly and auto-pick uses real projections.

**Architecture:** `getEventScores` is a read-through cache over v1's pure `scoreEvent`: it compares a stamp built from `tba_cache` body hashes (metadata only, no bodies) against the stored `event_scores` row and re-scores only when TBA data changed. Round and league views switch to it. A pure summarizer turns one event's TBA data + scores into per-team facts, an aggregator rolls those into one `team_stats` row per team per season, and a script (past seasons) plus a daily Vercel cron (current season) keep the table filled. The SP4 pool endpoint gets its stats from `team_stats` by swapping one default argument.

**Tech Stack:** Next.js 16.3 App Router, TypeScript strict, Supabase Postgres (`@supabase/supabase-js` 2), zod 4, Vitest 5, tsx scripts, Vercel Hobby cron.

**Spec:** `docs/superpowers/specs/2026-09-30-frc-fantasy-v2-design.md` — §5.6 (`event_scores`), §6 (team info), §3 (cron route), §8.1 (security). Plan index with the cross-plan contract: `docs/superpowers/plans/2026-09-30-frc-fantasy-v2.md`.

**Built third.** SP1 (accounts) and SP4 (live draft) are merged before this plan starts. SP2 (formats) comes after and reuses `getEventScores` for season rounds.

## Global Constraints

All constraints in `docs/superpowers/plans/2026-09-30-frc-fantasy-v2.md` apply. SP3-specific ones, copied from the spec:

- **Projection** (§6.1): `proj = (2 × total_points[Y] + total_points[Y−1]) / (2 × events_played[Y] + events_played[Y−1])`, rounded to 1 decimal. Missing seasons count as 0/0. Denominator 0 → `null`, shown as **"New"**.
- **Points always use `DEFAULT_SCORING`** (`lib/scoring/config.ts`), read through `getEventScores`, so `event_scores` rows for the default config double as the stats source.
- **Events counted** (§6.1): every event in the season except preseason (`event_type` 100), including offseason (99) when TBA has match data. Events with no played qual matches for the team are skipped (this skips Einstein on purpose).
- **Best finish** order: `winner` > `finalist` > `captain` > `picked`; `null` = never on an alliance.
- **Latest OPR / rank:** from the team's most recent event (by `end_date`) in season `Y` with data; falls back to `Y−1`.
- **Season `Y` of a draft** = the year of the round's `startDate` (Ramp Riot 2026 → 2026 ×2 + 2025 ×1).
- **Past-season build:** `scripts/build-team-stats.ts <season>`, throttled to **~5 TBA requests/s**, past-season paths use a **"never refetch"** window once cached.
- **Current-season refresh:** the daily cron re-scores events of the current season with any day in **`[today − 8, today]`**, then recomputes `team_stats` for every team at those events. Each run **stops at 50 s** and continues on the next run.
- **Cron:** `GET /api/cron/daily`, `Authorization: Bearer $CRON_SECRET` (constant-time compare, else 401), `export const maxDuration = 60`, Vercel schedule `0 10 * * *`.
- **Nothing is computed on the fly during page loads** for `team_stats`; teams with no row for either season show "New".
- **Draft pool UI** (§6.3): row = bumper plate · nickname · **Proj** · W-L-T · best finish badge · OPR / rank. "New" teams show a **"New" chip** instead of Proj. Sort: Proj (default, desc; "New" last), OPR, team number. Footnote text, verbatim: **`Proj. uses standard scoring`**.
- `event_scores` and `team_stats` are written **only** through `lib/scores/eventScores.ts` and `lib/stats/build.ts` (and the rebuild script's truncate).
- RLS is enabled on `event_scores` and `team_stats` with no policies.

## Deviations from the spec (flagged for Joey)

1. **`event_scores` gets one extra column, `info jsonb`** (team nicknames, "has event data", "has rankings"). The round page needs these alongside scores; storing them lets a cache hit skip reading TBA bodies entirely, which is the point of §5.6.
2. **`getEventScores` returns `{ scores, info, stale, fetchedAt }`** — the contract's shape plus `info`, and it takes an optional 4th `opts` argument (`now`, `repo`, `tba` deps). Additive; reported to the controller as a contract update.
3. **On a cache miss, bodies are read anyway** (v1's `getTba` reads the full cache row), so the stamp comparison after a refresh only saves the `scoreEvent` run, not the body read. Hits — the common case — read no bodies.
4. **No stamp when a TBA path has never been cached.** If any of the six paths has no `tba_cache` row, `getEventScores` scores directly and neither reads nor writes `event_scores`. (Otherwise every "TBA never answered" event would share one meaningless stamp.)
5. **`build-team-stats` is resumable through `tba_cache`, not through `event_scores` presence.** Every TBA response is saved as it arrives; with the "never refetch" window a rerun reads those rows instead of calling TBA, so an interrupted run picks up where it stopped at database speed.
6. **The cron refreshes the least-recently-updated teams first**, so a run that hits the 50 s budget makes progress on the next run instead of redoing the same teams.
7. **Played quals only:** "≥ 1 qual match" means ≥ 1 qual match *with a result*, so an event whose schedule is posted but not yet played doesn't count as an event with 0 points.
8. **Awards shown in the team sheet skip `DEFAULT_SCORING.awards.excludedTypes`** (Winner/Finalist, which the finish badge already shows, and individual awards like Dean's List).

## Review Focus

Inputs the spec implies but no happy-path test exercises, most likely to bite first. Each is pinned by a test in the named task.

1. **The same TBA JSON comes back with its keys in a different order** (Postgres `jsonb` reorders keys; a 304 re-saves the body read back from the database) → the body hash and stamp are unchanged, so nothing is re-scored. *Test in Task 2.*
2. **A round page is opened for an event TBA has never answered** (all six paths missing, or TBA down on the first view) → scores come back empty and marked stale, no `event_scores` row is written, and the next view tries TBA again. *Test in Task 6.*
3. **A team plays only Einstein, or an event's schedule is posted but no qual match has a result yet** → that event isn't counted in `events_played` and doesn't drag the projection toward 0. *Test in Task 9.*
4. **The cron hits its 50 s budget partway through** → it stops cleanly, reports "not complete", and the next run starts with the teams it didn't reach. *Test in Task 12.*
5. **A team has a 2025 row but no 2026 row (or the reverse)** → Proj uses the season that exists, W-L-T and best finish fall back to 2025, and OPR/rank come from the latest event that has data — never a crash or a blank "0.0". *Test in Task 14.*

## File Structure

```
supabase/migrations/0004_team_stats.sql   tba_cache.body_hash, event_scores, team_stats (Task 1)
lib/db/types.ts                           + CacheMeta, EventScoresRow, BestFinish, TeamStats* (Task 1)
lib/scores/hash.ts                        canonicalJson, sha256Hex, bodyHash, configHash, sourceStamp (Task 2)
lib/db/repo.ts                            + getCacheMeta, event_scores + team_stats methods (Tasks 3–4)
lib/db/supabaseRepo.ts                    same, against Postgres; body_hash computed in upsertCache (Tasks 3–4)
tests/helpers/memoryRepo.ts               same, in memory (Tasks 3–4)
lib/tba/clean.ts                          cleanEventData, NO_EVENT_DATA, eventInfo (moved from views/round) (Task 5)
lib/tba/event.ts                          loadEventData gains an optional deps argument (Task 5)
lib/scores/serialize.ts                   serialize/deserializeEventScores, EventInfo schema (Task 5)
lib/scores/eventScores.ts                 getEventScores (re-exports the serializers) (Task 6)
lib/views/round.ts                        buildRoundView reads through getEventScores (Task 7)
scripts/backfill-body-hash.ts             one-time: fills body_hash for existing rows (Task 3)
scripts/rebuild-event-scores.ts           truncates event_scores (Task 8)
lib/stats/projection.ts                   projection() (Task 9)
lib/stats/summarize.ts                    summarizeEvent, aggregateTeamSeason (Task 9–10)
lib/tba/throttle.ts                       throttleFetch (Task 11)
lib/stats/build.ts                        statsWindowMs, loadEventSummaries, buildSeasonStats, refreshRecentTeams (Tasks 11–12)
scripts/build-team-stats.ts               past/current season build (Task 11)
scripts/show-team-stats.ts                prints one team's rows, for spot checks (Task 11)
lib/cron/auth.ts                          cronAuthorized (Task 13)
lib/cron/jobs.ts                          DailyJob, DAILY_JOBS, runDailyJobs (Task 13)
app/api/cron/daily/route.ts               the cron endpoint (Task 13)
vercel.json                               cron schedule (Task 13)
lib/stats/pool.ts                         teamStatsPoolLookup (Task 14)
lib/pool/entries.ts                       default stats lookup → teamStatsPoolLookup (Task 14)
lib/pool/sort.ts                          sortPool, formatProj, formatRecord, BEST_FINISH_LABEL (Task 15)
components/pool/PoolStats.tsx             PoolStatCells, NewChip, PoolFootnote (Task 15)
components/pool/PoolSortControl.tsx       Proj / OPR / Team # control (Task 15)
app/api/l/[slug]/rounds/[id]/pool/[teamKey]/route.ts   team sheet data (Task 16)
components/pool/TeamSheet.tsx             per-event history sheet (Task 16)
tests/scores/*.test.ts  tests/stats/*.test.ts  tests/cron/*.test.ts  tests/pool/*.test.ts
```

**Why this shape:** hashing, serializing, and cache logic are separate files so each has one job and its own tests. The stats pipeline is split into a pure part (`summarize.ts`, `projection.ts`, tested with fixtures and builders, no I/O) and an I/O part (`build.ts`, tested with the in-memory repo and a fake `fetch`). The cron route only authenticates and runs a list of jobs, so SP2 adds its jobs by appending to `DAILY_JOBS` without touching the route.

## Spec coverage map

| Spec | Task |
|---|---|
| §5.6 `body_hash`, `event_scores` table | 1, 3, 4 |
| §5.6 `getEventScores` steps 1–5 | 2, 6 |
| §5.6 implementation notes (hash in `upsertCache`, batched meta, serializer) | 2, 3, 5 |
| §5.6 rules: rebuildable, views read through it, replay test, CLAUDE.md wording | 7, 8, 18 |
| §6.1 `team_stats`, events counted, projection, latest OPR/rank, best finish | 1, 9, 10, 14 |
| §6.2 build script (resumable, throttled, never-refetch, storage) | 11, 17 |
| §6.2 current-season cron refresh, 50 s budget | 12, 13 |
| §3 cron route, `maxDuration = 60`; §8.1 constant-time bearer | 13 |
| §6.3 pool endpoint stats, row, sort, "New", footnote, team sheet | 14, 15, 16 |
| §8.1 RLS on for new tables | 1 |
| §13 docs | 18 |

---

### Task 1: Migration `0004_team_stats.sql` and row types

**Files:**
- Create: `supabase/migrations/0004_team_stats.sql`
- Modify: `lib/db/types.ts` (append types)
- Test: `tests/db/migration-0004.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by every later task):
  ```ts
  export type CacheMeta = { path: string; fetchedAt: string; bodyHash: string | null; lastErrorAt: string | null };
  export type EventScoresRow = { eventKey: string; configHash: string; sourceStamp: string; scores: unknown; info: unknown; computedAt: string };
  export type BestFinish = 'winner' | 'finalist' | 'captain' | 'picked';
  export type TeamStatsAward = { type: number; name: string; eventKey: string };
  export type TeamStatsEvent = { eventKey: string; name: string; endDate: string; rank: number | null; finish: BestFinish | null; points: number };
  export type TeamStatsRow = { teamKey: string; season: number; eventsPlayed: number; totalPoints: number; qualWins: number; qualLosses: number; qualTies: number; bestFinish: BestFinish | null; awards: TeamStatsAward[]; events: TeamStatsEvent[]; latestEventKey: string | null; latestOpr: number | null; latestRank: number | null; updatedAt: string };
  ```

- [ ] **Step 1: Start the SP3 branch**

```bash
git switch main && git pull && git switch -c v2-sp3-team-info
```

- [ ] **Step 2: Write the failing test**

Create `tests/db/migration-0004.test.ts`. It guards the two things a typo would silently break: RLS on the new tables and the exact column names the repo code uses.

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '0004_team_stats.sql'), 'utf8');

describe('migration 0004_team_stats.sql', () => {
  it('adds body_hash to tba_cache', () => {
    expect(sql).toMatch(/alter table tba_cache\s+add column body_hash text/);
  });

  it.each(['event_scores', 'team_stats'])('creates %s with RLS on and no policies', (table) => {
    expect(sql).toMatch(new RegExp(`create table ${table} \\(`));
    expect(sql).toMatch(new RegExp(`alter table ${table}\\s+enable row level security`));
    expect(sql).not.toMatch(/create policy/i);
  });

  it('keys event_scores by (event_key, config_hash) and team_stats by (team_key, season)', () => {
    expect(sql).toMatch(/primary key \(event_key, config_hash\)/);
    expect(sql).toMatch(/primary key \(team_key, season\)/);
  });

  it('has every column the repo reads', () => {
    for (const col of [
      'source_stamp', 'scores', 'info', 'computed_at',
      'events_played', 'total_points', 'qual_wins', 'qual_losses', 'qual_ties', 'best_finish',
      'awards', 'events', 'latest_event_key', 'latest_opr', 'latest_rank', 'updated_at',
    ]) {
      expect(sql, col).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run tests/db/migration-0004.test.ts`
Expected: FAIL with `ENOENT: no such file or directory, open '.../0004_team_stats.sql'`.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/0004_team_stats.sql`:

```sql
-- 0004_team_stats.sql — SP3 (spec §5.6, §6.1). Additive only: the previous deploy keeps working.
-- event_scores and team_stats are DERIVED caches. They can be truncated at any time and rebuild
-- themselves (scripts/rebuild-event-scores.ts, scripts/build-team-stats.ts).

-- sha256 of the canonical JSON of tba_cache.body; null when body is null. Written by the app's
-- upsertCache, never by callers. Existing rows are filled by scripts/backfill-body-hash.ts.
alter table tba_cache add column body_hash text;

create table event_scores (
  event_key     text not null check (event_key ~ '^[0-9]{4}[a-z0-9]+$'),
  config_hash   text not null,   -- sha256 of canonical (sorted-key) JSON of the ScoringConfig
  source_stamp  text not null,   -- sha256 of the six input paths' body_hash values, in fixed path order
  scores        jsonb not null,  -- serialized EventScores: { teams: { [teamKey]: { teamKey, total, lines } }, qualsComplete, rpMethod }
  info          jsonb not null default '{}',  -- { teamNames, hasEventData, hasRankings } for the round page
  computed_at   timestamptz not null default now(),
  primary key (event_key, config_hash)
);

create table team_stats (
  team_key          text not null check (team_key ~ '^frc[1-9][0-9]{0,4}[A-Z]?$'),
  season            integer not null check (season between 1992 and 2100),
  events_played     integer not null,          -- events with >= 1 played qual match for this team
  total_points      integer not null,          -- fantasy points over those events, DEFAULT_SCORING
  qual_wins         integer not null,
  qual_losses       integer not null,
  qual_ties         integer not null,
  best_finish       text check (best_finish in ('winner', 'finalist', 'captain', 'picked')),  -- null = not picked
  awards            jsonb not null default '[]',   -- [{ "type": 0, "name": "Impact Award", "eventKey": "2026paca" }]
  events            jsonb not null default '[]',   -- [{ "eventKey", "name", "endDate", "rank", "finish", "points" }]
  latest_event_key  text,
  latest_opr        numeric(6, 1),
  latest_rank       integer,
  updated_at        timestamptz not null default now(),
  primary key (team_key, season)
);
create index team_stats_season_idx on team_stats (season);

alter table event_scores enable row level security;
alter table team_stats   enable row level security;
```

- [ ] **Step 5: Add the row types**

Append to `lib/db/types.ts`:

```ts
/** tba_cache without the body: what getEventScores needs to decide if its cached scores are current. */
export type CacheMeta = {
  path: string;
  fetchedAt: string;
  /** sha256 of the canonical JSON body; null when TBA had no data. */
  bodyHash: string | null;
  lastErrorAt: string | null;
};

/** One row of the derived event_scores cache (spec §5.6). `scores` and `info` are validated on read. */
export type EventScoresRow = {
  eventKey: string;
  configHash: string;
  sourceStamp: string;
  scores: unknown;
  info: unknown;
  computedAt: string;
};

export type BestFinish = 'winner' | 'finalist' | 'captain' | 'picked';

export type TeamStatsAward = { type: number; name: string; eventKey: string };

export type TeamStatsEvent = {
  eventKey: string;
  name: string;
  endDate: string; // YYYY-MM-DD
  rank: number | null;
  finish: BestFinish | null;
  points: number;
};

/** One row of the derived team_stats table (spec §6.1): one team, one season, default scoring. */
export type TeamStatsRow = {
  teamKey: string;
  season: number;
  eventsPlayed: number;
  totalPoints: number;
  qualWins: number;
  qualLosses: number;
  qualTies: number;
  bestFinish: BestFinish | null;
  awards: TeamStatsAward[];
  events: TeamStatsEvent[];
  latestEventKey: string | null;
  latestOpr: number | null;
  latestRank: number | null;
  updatedAt: string;
};
```

- [ ] **Step 6: Run the test and the typecheck**

Run: `npx vitest run tests/db/migration-0004.test.ts && npm run typecheck`
Expected: 5 tests PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0004_team_stats.sql lib/db/types.ts tests/db/migration-0004.test.ts
git commit -m "feat(sp3): migration 0004 — tba_cache.body_hash, event_scores, team_stats"
```

(Every commit message in this plan ends with a blank line and the session's `Co-Authored-By:` trailer; it's left out of the snippets for brevity.)

The migration is **not applied yet**. Task 17 applies it (with Joey) before the build scripts run.

---

### Task 2: Hashing helpers

**Files:**
- Create: `lib/scores/hash.ts`
- Test: `tests/scores/hash.test.ts`

**Interfaces:**
- Consumes: `CacheMeta` (Task 1), `ScoringConfig` (v1 `lib/scoring/config.ts`).
- Produces:
  ```ts
  export function canonicalJson(value: unknown): string;
  export function sha256Hex(text: string): string;
  export function bodyHash(body: unknown): string | null;         // null for null/undefined
  export function configHash(config: ScoringConfig): string;
  export function sourceStamp(paths: string[], meta: Map<string, CacheMeta>): string | null;  // null if any path has no meta
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/scores/hash.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CacheMeta } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { bodyHash, canonicalJson, configHash, sha256Hex, sourceStamp } from '@/lib/scores/hash';

describe('canonicalJson', () => {
  it('sorts object keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: null } })).toBe('{"a":{"c":null,"d":[3,1]},"b":1}');
  });

  it('drops undefined object values and writes undefined array items as null, like JSON.stringify', () => {
    expect(canonicalJson({ a: undefined, b: [undefined, 2] })).toBe('{"b":[null,2]}');
  });

  it('handles plain values', () => {
    expect(canonicalJson('x')).toBe('"x"');
    expect(canonicalJson(1.5)).toBe('1.5');
    expect(canonicalJson(null)).toBe('null');
  });
});

describe('sha256Hex', () => {
  it('matches the known digest of "abc"', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('bodyHash', () => {
  it('is null for no data', () => {
    expect(bodyHash(null)).toBeNull();
    expect(bodyHash(undefined)).toBeNull();
  });

  // Review Focus 1: Postgres jsonb hands keys back in its own order, and a TBA 304 re-saves the
  // body read from the database. The hash must not change, or every 304 would force a re-score.
  it('is the same when the same JSON comes back with its keys reordered', () => {
    const fromTba = { rankings: [{ rank: 1, team_key: 'frc341', record: { wins: 5, losses: 0, ties: 0 } }], extra_stats_info: [] };
    const fromJsonb = { extra_stats_info: [], rankings: [{ record: { ties: 0, losses: 0, wins: 5 }, team_key: 'frc341', rank: 1 }] };
    expect(bodyHash(fromJsonb)).toBe(bodyHash(fromTba));
  });

  it('changes when a value changes', () => {
    expect(bodyHash({ a: 1 })).not.toBe(bodyHash({ a: 2 }));
  });
});

describe('configHash', () => {
  it('is stable across key order and changes with any point value', () => {
    const a = defaultScoring();
    // Same values, top-level keys in reverse insertion order.
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
    const b = defaultScoring();
    b.qualWin += 1;
    expect(configHash(a)).toHaveLength(64);
    expect(configHash(reordered)).toBe(configHash(a));
    expect(configHash(b)).not.toBe(configHash(a));
  });
});

describe('sourceStamp', () => {
  const meta = (path: string, hash: string | null): CacheMeta => ({
    path,
    fetchedAt: '2026-10-24T12:00:00.000Z',
    bodyHash: hash,
    lastErrorAt: null,
  });
  const paths = ['/a', '/b'];

  it('depends on each path hash, in the given path order', () => {
    const one = sourceStamp(paths, new Map([['/a', meta('/a', 'h1')], ['/b', meta('/b', null)]]));
    const two = sourceStamp(paths, new Map([['/a', meta('/a', 'h1')], ['/b', meta('/b', 'h2')]]));
    expect(one).toHaveLength(64);
    expect(two).not.toBe(one);
  });

  it('ignores fetch times (a 304 refresh keeps the stamp)', () => {
    const early = new Map([['/a', meta('/a', 'h1')], ['/b', meta('/b', 'h2')]]);
    const late = new Map([['/a', { ...meta('/a', 'h1'), fetchedAt: '2026-10-25T00:00:00.000Z' }], ['/b', meta('/b', 'h2')]]);
    expect(sourceStamp(paths, late)).toBe(sourceStamp(paths, early));
  });

  it('is null when any path has never been cached', () => {
    expect(sourceStamp(paths, new Map([['/a', meta('/a', 'h1')]]))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/scores/hash.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/scores/hash"`.

- [ ] **Step 3: Implement**

Create `lib/scores/hash.ts`:

```ts
import { createHash } from 'node:crypto';
import type { CacheMeta } from '@/lib/db/types';
import type { ScoringConfig } from '@/lib/scoring/config';

/**
 * JSON with object keys sorted at every depth. Postgres jsonb stores keys in its own order, so the
 * same TBA body can come back with keys shuffled; hashing this form keeps the hash stable.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The tba_cache.body_hash value. Computed only inside the repos' upsertCache (spec §5.6). */
export function bodyHash(body: unknown): string | null {
  return body === null || body === undefined ? null : sha256Hex(canonicalJson(body));
}

export function configHash(config: ScoringConfig): string {
  return sha256Hex(canonicalJson(config));
}

/**
 * sha256 over "path=hash" lines in the given (fixed) path order. Fetch times are left out on
 * purpose: a 304 refresh moves fetched_at but not the data. Null when any path has no cache row,
 * because then there is nothing trustworthy to compare against.
 */
export function sourceStamp(paths: string[], meta: Map<string, CacheMeta>): string | null {
  const lines: string[] = [];
  for (const path of paths) {
    const m = meta.get(path);
    if (!m) return null;
    lines.push(`${path}=${m.bodyHash ?? 'null'}`);
  }
  return sha256Hex(lines.join('\n'));
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/scores/hash.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scores/hash.ts tests/scores/hash.test.ts
git commit -m "feat(sp3): canonical JSON and hashing helpers for event_scores"
```

---

### Task 3: `body_hash` in `upsertCache`, batched `getCacheMeta`, backfill script

**Files:**
- Modify: `lib/db/repo.ts` (Repo interface)
- Modify: `lib/db/supabaseRepo.ts` (`upsertCache`, new `getCacheMeta`, `toCacheMeta`, `chunks`)
- Modify: `tests/helpers/memoryRepo.ts` (`upsertCache`, new `getCacheMeta`)
- Create: `scripts/backfill-body-hash.ts`
- Test: `tests/db/cacheMeta.test.ts`

**Interfaces:**
- Consumes: `bodyHash` (Task 2), `CacheMeta` (Task 1).
- Produces on `Repo`:
  ```ts
  getCacheMeta(paths: string[]): Promise<CacheMeta[]>; // rows that exist, any order; no bodies
  ```
  `upsertCache(row: CacheRow)` keeps its v1 signature; both repos compute `body_hash` from `row.body` themselves. `CacheRow` does **not** gain a hash field, so `getTba` and its tests don't change.

- [ ] **Step 1: Write the failing test**

Create `tests/db/cacheMeta.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { Repo } from '@/lib/db/repo';
import type { CacheRow } from '@/lib/db/types';
import { bodyHash } from '@/lib/scores/hash';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
const row = (path: string, body: unknown, extra: Partial<CacheRow> = {}): CacheRow => ({
  path,
  etag: '"e"',
  body,
  fetchedAt: '2026-10-24T12:00:00.000Z',
  lastError: null,
  lastErrorAt: null,
  ...extra,
});

beforeEach(() => {
  repo = createMemoryRepo();
});

describe('getCacheMeta', () => {
  it('returns metadata for the paths that exist, with body_hash computed on write', async () => {
    await repo.upsertCache(row('/event/x/teams/simple', [{ key: 'frc1' }]));
    await repo.upsertCache(row('/event/x/awards', null, { lastErrorAt: '2026-10-24T12:01:00.000Z' }));

    const meta = await repo.getCacheMeta(['/event/x/teams/simple', '/event/x/awards', '/event/x/oprs']);
    const byPath = new Map(meta.map((m) => [m.path, m]));

    expect(meta).toHaveLength(2);
    expect(byPath.get('/event/x/teams/simple')).toEqual({
      path: '/event/x/teams/simple',
      fetchedAt: '2026-10-24T12:00:00.000Z',
      bodyHash: bodyHash([{ key: 'frc1' }]),
      lastErrorAt: null,
    });
    expect(byPath.get('/event/x/awards')?.bodyHash).toBeNull();
    expect(byPath.get('/event/x/awards')?.lastErrorAt).toBe('2026-10-24T12:01:00.000Z');
  });

  it('keeps the hash when the same body is re-saved (a 304 or a failed refresh)', async () => {
    await repo.upsertCache(row('/p', { b: 1, a: 2 }));
    const before = (await repo.getCacheMeta(['/p']))[0].bodyHash;
    await repo.upsertCache(row('/p', { a: 2, b: 1 }, { fetchedAt: '2026-10-24T13:00:00.000Z' }));
    expect((await repo.getCacheMeta(['/p']))[0].bodyHash).toBe(before);
  });

  it('returns nothing for an empty path list', async () => {
    expect(await repo.getCacheMeta([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/db/cacheMeta.test.ts`
Expected: FAIL with `repo.getCacheMeta is not a function`.

- [ ] **Step 3: Add the method to the Repo interface**

In `lib/db/repo.ts`, add `CacheMeta` to the type import from `@/lib/db/types`, and add below `upsertCache`:

```ts
  /** Metadata for the given tba_cache paths (no bodies), for the rows that exist. One round trip per 100 paths. */
  getCacheMeta(paths: string[]): Promise<CacheMeta[]>;
```

- [ ] **Step 4: Implement in the memory repo**

In `tests/helpers/memoryRepo.ts`, import `bodyHash` from `@/lib/scores/hash` and `CacheMeta` from `@/lib/db/types`. Replace the `cache` map declaration and the two cache methods:

```ts
  const cache = new Map<string, CacheRow & { bodyHash: string | null }>();
```

```ts
    async getCache(path) {
      const hit = cache.get(path);
      if (!hit) return null;
      const { bodyHash: _hash, ...row } = hit;
      return copy(row);
    },
    async upsertCache(row) {
      // Like the real repo: the hash is computed here, never passed in (spec §5.6).
      cache.set(row.path, { ...copy(row), bodyHash: bodyHash(row.body) });
    },
    async getCacheMeta(paths) {
      const out: CacheMeta[] = [];
      for (const path of paths) {
        const hit = cache.get(path);
        if (hit) {
          out.push({ path, fetchedAt: hit.fetchedAt, bodyHash: hit.bodyHash, lastErrorAt: hit.lastErrorAt });
        }
      }
      return out;
    },
```

- [ ] **Step 5: Implement in the Supabase repo**

In `lib/db/supabaseRepo.ts`: import `bodyHash` from `@/lib/scores/hash` and `CacheMeta` from `@/lib/db/types`. Add next to `toCache`:

```ts
const toCacheMeta = (r: Raw): CacheMeta => ({
  path: r.path,
  fetchedAt: r.fetched_at,
  bodyHash: r.body_hash,
  lastErrorAt: r.last_error_at,
});

/** Splits a list so `.in(...)` filters stay well under PostgREST's URL length limit. */
function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
```

Replace `upsertCache` and add `getCacheMeta` after it:

```ts
    async upsertCache(row) {
      await run(
        db.from('tba_cache').upsert(
          {
            path: row.path,
            etag: row.etag,
            body: row.body, // JS null is stored as SQL NULL
            body_hash: bodyHash(row.body), // computed here only (spec §5.6), so 304s keep the same hash
            fetched_at: row.fetchedAt,
            last_error: row.lastError,
            last_error_at: row.lastErrorAt,
          },
          { onConflict: 'path' },
        ),
      );
    },
    async getCacheMeta(paths) {
      if (paths.length === 0) return [];
      const batches = await Promise.all(
        chunks(paths, 100).map((batch) =>
          run(db.from('tba_cache').select('path, fetched_at, body_hash, last_error_at').in('path', batch)),
        ),
      );
      return batches.flat().map(toCacheMeta);
    },
```

- [ ] **Step 6: Write the backfill script**

Create `scripts/backfill-body-hash.ts`. It uses the same `bodyHash` as the app, so hashes match exactly (a SQL `sha256(body::text)` would not, because jsonb's text form isn't our canonical form).

```ts
// One-time, after migration 0004: fills tba_cache.body_hash for rows written before the column existed.
// Usage: npx tsx --env-file=.env.local scripts/backfill-body-hash.ts
import { createSupabaseClient } from '@/lib/db/supabaseRepo';
import { bodyHash } from '@/lib/scores/hash';

async function main() {
  const db = createSupabaseClient();
  let done = 0;
  for (;;) {
    const { data, error } = await db.from('tba_cache').select('path, body').is('body_hash', null).not('body', 'is', null).limit(200);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const { error: upErr } = await db.from('tba_cache').update({ body_hash: bodyHash(row.body) }).eq('path', row.path);
      if (upErr) throw new Error(upErr.message);
      done += 1;
    }
    console.log(`hashed ${done} rows so far`);
  }
  console.log(`Done: ${done} rows hashed. Rows with no body keep body_hash = null.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `npx vitest run tests/db && npm run typecheck`
Expected: the new tests PASS, the existing `tests/db/memoryRepo.test.ts` still PASSES, typecheck clean.

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: all PASS (the `getTba` tests use their own fake store, so they are unaffected).

- [ ] **Step 9: Commit**

```bash
git add lib/db/repo.ts lib/db/supabaseRepo.ts tests/helpers/memoryRepo.ts scripts/backfill-body-hash.ts tests/db/cacheMeta.test.ts
git commit -m "feat(sp3): body_hash computed in upsertCache, batched getCacheMeta, backfill script"
```

---

### Task 4: Repo methods for `event_scores` and `team_stats`

**Files:**
- Modify: `lib/db/repo.ts`, `lib/db/supabaseRepo.ts`, `tests/helpers/memoryRepo.ts`
- Test: `tests/db/derivedTables.test.ts`

**Interfaces:**
- Consumes: `EventScoresRow`, `TeamStatsRow` (Task 1), `chunks` (Task 3).
- Produces on `Repo`:
  ```ts
  getEventScoresRow(eventKey: string, configHash: string): Promise<EventScoresRow | null>;
  upsertEventScoresRow(row: EventScoresRow): Promise<void>;
  clearEventScores(): Promise<number>;                     // rows deleted; only scripts/rebuild-event-scores.ts calls it
  getTeamStats(teamKeys: string[], seasons: number[], opts?: { withHistory?: boolean }): Promise<TeamStatsRow[]>;
  upsertTeamStats(rows: TeamStatsRow[]): Promise<void>;
  ```
  Without `withHistory`, `awards` and `events` come back as `[]` (the pool only needs the summary columns; a 3,500-team season pool would otherwise pull megabytes of history).

- [ ] **Step 1: Write the failing test**

Create `tests/db/derivedTables.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { Repo } from '@/lib/db/repo';
import type { EventScoresRow, TeamStatsRow } from '@/lib/db/types';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
beforeEach(() => {
  repo = createMemoryRepo();
});

const scoresRow = (extra: Partial<EventScoresRow> = {}): EventScoresRow => ({
  eventKey: '2025parr',
  configHash: 'c1',
  sourceStamp: 's1',
  scores: { teams: {}, qualsComplete: true, rpMethod: 'extra_stats' },
  info: { teamNames: {}, hasEventData: true, hasRankings: true },
  computedAt: '2026-10-24T12:00:00.000Z',
  ...extra,
});

const statsRow = (teamKey: string, season: number, extra: Partial<TeamStatsRow> = {}): TeamStatsRow => ({
  teamKey,
  season,
  eventsPlayed: 2,
  totalPoints: 80,
  qualWins: 9,
  qualLosses: 3,
  qualTies: 0,
  bestFinish: 'captain',
  awards: [{ type: 0, name: 'Impact Award', eventKey: `${season}paca` }],
  events: [{ eventKey: `${season}paca`, name: 'Greater Pittsburgh', endDate: `${season}-03-15`, rank: 2, finish: 'captain', points: 44 }],
  latestEventKey: `${season}paca`,
  latestOpr: 41.2,
  latestRank: 2,
  updatedAt: '2026-10-24T12:00:00.000Z',
  ...extra,
});

describe('event_scores', () => {
  it('stores one row per (event, config) and replaces it on upsert', async () => {
    await repo.upsertEventScoresRow(scoresRow());
    await repo.upsertEventScoresRow(scoresRow({ configHash: 'c2' }));
    await repo.upsertEventScoresRow(scoresRow({ sourceStamp: 's2' }));

    expect((await repo.getEventScoresRow('2025parr', 'c1'))?.sourceStamp).toBe('s2');
    expect((await repo.getEventScoresRow('2025parr', 'c2'))?.sourceStamp).toBe('s1');
    expect(await repo.getEventScoresRow('2025parr', 'nope')).toBeNull();
  });

  it('can be cleared completely (the cache is rebuildable)', async () => {
    await repo.upsertEventScoresRow(scoresRow());
    await repo.upsertEventScoresRow(scoresRow({ eventKey: '2026parr' }));
    expect(await repo.clearEventScores()).toBe(2);
    expect(await repo.getEventScoresRow('2025parr', 'c1')).toBeNull();
  });
});

describe('team_stats', () => {
  it('returns only the asked-for teams and seasons, summary columns by default', async () => {
    await repo.upsertTeamStats([statsRow('frc341', 2026), statsRow('frc341', 2025), statsRow('frc5181', 2026), statsRow('frc341', 2024)]);

    const rows = await repo.getTeamStats(['frc341'], [2026, 2025]);
    expect(rows.map((r) => r.season).sort()).toEqual([2025, 2026]);
    expect(rows.every((r) => r.awards.length === 0 && r.events.length === 0)).toBe(true);
    expect(rows[0].latestOpr).toBe(41.2);
  });

  it('includes awards and per-event history when asked', async () => {
    await repo.upsertTeamStats([statsRow('frc341', 2026)]);
    const [row] = await repo.getTeamStats(['frc341'], [2026], { withHistory: true });
    expect(row.events).toHaveLength(1);
    expect(row.awards[0].name).toBe('Impact Award');
  });

  it('replaces a (team, season) row on upsert', async () => {
    await repo.upsertTeamStats([statsRow('frc341', 2026)]);
    await repo.upsertTeamStats([statsRow('frc341', 2026, { totalPoints: 120 })]);
    const rows = await repo.getTeamStats(['frc341'], [2026]);
    expect(rows).toHaveLength(1);
    expect(rows[0].totalPoints).toBe(120);
  });

  it('handles empty inputs', async () => {
    await repo.upsertTeamStats([]);
    expect(await repo.getTeamStats([], [2026])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/db/derivedTables.test.ts`
Expected: FAIL with `repo.upsertEventScoresRow is not a function`.

- [ ] **Step 3: Extend the Repo interface**

In `lib/db/repo.ts`, add `EventScoresRow` and `TeamStatsRow` to the type import, and append inside `interface Repo`:

```ts
  // Derived caches (spec §5.6, §6.1). Written only by lib/scores/eventScores.ts and lib/stats/build.ts.
  getEventScoresRow(eventKey: string, configHash: string): Promise<EventScoresRow | null>;
  upsertEventScoresRow(row: EventScoresRow): Promise<void>;
  /** Deletes every event_scores row; returns how many. Only scripts/rebuild-event-scores.ts calls this. */
  clearEventScores(): Promise<number>;
  /** Without withHistory, awards and events come back empty (the draft pool only needs the summary). */
  getTeamStats(teamKeys: string[], seasons: number[], opts?: { withHistory?: boolean }): Promise<TeamStatsRow[]>;
  upsertTeamStats(rows: TeamStatsRow[]): Promise<void>;
```

- [ ] **Step 4: Implement in the memory repo**

In `tests/helpers/memoryRepo.ts`, add the imports for `EventScoresRow` and `TeamStatsRow`, declare the storage next to `cache`:

```ts
  const eventScores = new Map<string, EventScoresRow>();
  const teamStats = new Map<string, TeamStatsRow>();
```

and add the methods at the end of the returned object:

```ts
    async getEventScoresRow(eventKey, configHash) {
      return copy(eventScores.get(`${eventKey}|${configHash}`) ?? null);
    },
    async upsertEventScoresRow(row) {
      eventScores.set(`${row.eventKey}|${row.configHash}`, copy(row));
    },
    async clearEventScores() {
      const n = eventScores.size;
      eventScores.clear();
      return n;
    },
    async getTeamStats(teamKeys, seasons, opts = {}) {
      const out: TeamStatsRow[] = [];
      for (const row of teamStats.values()) {
        if (!teamKeys.includes(row.teamKey) || !seasons.includes(row.season)) continue;
        out.push(opts.withHistory ? copy(row) : { ...copy(row), awards: [], events: [] });
      }
      return out;
    },
    async upsertTeamStats(rows) {
      for (const row of rows) teamStats.set(`${row.teamKey}|${row.season}`, copy(row));
    },
```

- [ ] **Step 5: Implement in the Supabase repo**

In `lib/db/supabaseRepo.ts`, add the type imports and these mappers next to `toCacheMeta`:

```ts
const toEventScores = (r: Raw): EventScoresRow => ({
  eventKey: r.event_key,
  configHash: r.config_hash,
  sourceStamp: r.source_stamp,
  scores: r.scores,
  info: r.info,
  computedAt: r.computed_at,
});

const SUMMARY_COLUMNS =
  'team_key, season, events_played, total_points, qual_wins, qual_losses, qual_ties, best_finish, latest_event_key, latest_opr, latest_rank, updated_at';

const toTeamStats = (r: Raw): TeamStatsRow => ({
  teamKey: r.team_key,
  season: r.season,
  eventsPlayed: r.events_played,
  totalPoints: r.total_points,
  qualWins: r.qual_wins,
  qualLosses: r.qual_losses,
  qualTies: r.qual_ties,
  bestFinish: r.best_finish,
  awards: Array.isArray(r.awards) ? r.awards : [],
  events: Array.isArray(r.events) ? r.events : [],
  latestEventKey: r.latest_event_key,
  // numeric(6,1) arrives as a string or a number depending on the driver path.
  latestOpr: r.latest_opr === null || r.latest_opr === undefined ? null : Number(r.latest_opr),
  latestRank: r.latest_rank,
  updatedAt: r.updated_at,
});
```

and the methods at the end of the returned object:

```ts
    async getEventScoresRow(eventKey, configHash) {
      const rows = await run(
        db.from('event_scores').select().eq('event_key', eventKey).eq('config_hash', configHash).limit(1),
      );
      return rows[0] ? toEventScores(rows[0]) : null;
    },
    async upsertEventScoresRow(row) {
      await run(
        db.from('event_scores').upsert(
          {
            event_key: row.eventKey,
            config_hash: row.configHash,
            source_stamp: row.sourceStamp,
            scores: row.scores,
            info: row.info,
            computed_at: row.computedAt,
          },
          { onConflict: 'event_key,config_hash' },
        ),
      );
    },
    async clearEventScores() {
      // PostgREST refuses an unfiltered delete; "every row has an event key" matches them all.
      const rows = await run(db.from('event_scores').delete().neq('event_key', '').select('event_key'));
      return rows.length;
    },
    async getTeamStats(teamKeys, seasons, opts = {}) {
      if (teamKeys.length === 0 || seasons.length === 0) return [];
      const columns = opts.withHistory ? '*' : SUMMARY_COLUMNS;
      const batches = await Promise.all(
        chunks(teamKeys, 150).map((batch) =>
          run(db.from('team_stats').select(columns).in('team_key', batch).in('season', seasons)),
        ),
      );
      return batches.flat().map(toTeamStats);
    },
    async upsertTeamStats(rows) {
      for (const batch of chunks(rows, 200)) {
        await run(
          db.from('team_stats').upsert(
            batch.map((r) => ({
              team_key: r.teamKey,
              season: r.season,
              events_played: r.eventsPlayed,
              total_points: r.totalPoints,
              qual_wins: r.qualWins,
              qual_losses: r.qualLosses,
              qual_ties: r.qualTies,
              best_finish: r.bestFinish,
              awards: r.awards,
              events: r.events,
              latest_event_key: r.latestEventKey,
              latest_opr: r.latestOpr,
              latest_rank: r.latestRank,
              updated_at: r.updatedAt,
            })),
            { onConflict: 'team_key,season' },
          ),
        );
      }
    },
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run tests/db && npm run typecheck`
Expected: all PASS; typecheck clean. (If `run(...)` rejects the `.select(columns)` string type, cast the builder the same way the existing `select()` calls in this file are passed to `run`.)

- [ ] **Step 7: Commit**

```bash
git add lib/db/repo.ts lib/db/supabaseRepo.ts tests/helpers/memoryRepo.ts tests/db/derivedTables.test.ts
git commit -m "feat(sp3): repo methods for event_scores and team_stats"
```

---

### Task 5: Move `cleanEventData`, add `eventInfo`, serializers, and `loadEventData` deps

**Files:**
- Create: `lib/tba/clean.ts`
- Modify: `lib/views/round.ts` (import from `lib/tba/clean.ts`, re-export `cleanEventData`)
- Modify: `lib/tba/event.ts` (optional `deps` argument)
- Create: `lib/scores/serialize.ts`
- Test: `tests/scores/serialize.test.ts`, `tests/tba/eventDeps.test.ts`

**Interfaces:**
- Consumes: v1 `EventScores`, `TeamScore`, `Line`, `CategoryId`, `RpMethod` (`lib/scoring/types.ts`); v1 `getTba`, `TbaDeps` (`lib/tba/client.ts`).
- Produces:
  ```ts
  // lib/tba/clean.ts
  export const NO_EVENT_DATA: EventData;
  export function cleanEventData(data: EventData): EventData;           // moved verbatim from lib/views/round.ts
  export type EventInfo = { teamNames: Record<string, string>; hasEventData: boolean; hasRankings: boolean };
  export function eventInfo(data: EventData): EventInfo;
  // lib/tba/event.ts
  export async function loadEventData(eventKey: string, opts: { windowMs: number; force?: boolean }, deps?: Partial<TbaDeps>): Promise<LoadedEvent>;
  // lib/scores/serialize.ts
  export type SerializedEventScores = { teams: Record<string, TeamScore>; qualsComplete: boolean; rpMethod: RpMethod };
  export function serializeEventScores(s: EventScores): SerializedEventScores;
  export function deserializeEventScores(raw: unknown): EventScores | null;  // null when the shape is wrong
  export function parseEventInfo(raw: unknown): EventInfo | null;
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/scores/serialize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { scoreEvent } from '@/lib/scoring/engine';
import { deserializeEventScores, parseEventInfo, serializeEventScores } from '@/lib/scores/serialize';
import { cleanEventData, eventInfo } from '@/lib/tba/clean';
import { loadFixture } from '../helpers/fixture';
import { emptyEvent, match, rankRow, rankings } from '../helpers/builders';

const scored = scoreEvent(cleanEventData(loadFixture('2025parr')), DEFAULT_SCORING);

describe('serializeEventScores / deserializeEventScores', () => {
  it('round-trips the 2025parr scores through JSON (what jsonb stores)', () => {
    const stored = JSON.parse(JSON.stringify(serializeEventScores(scored)));
    const back = deserializeEventScores(stored);
    expect(back).not.toBeNull();
    expect(back!.teams.size).toBe(scored.teams.size);
    expect(back).toEqual(scored);
  });

  it('writes teams as a plain object keyed by team key', () => {
    const s = serializeEventScores(scored);
    expect(s.teams.frc2607.teamKey).toBe('frc2607');
    expect(s.rpMethod).toBe('extra_stats');
  });

  it.each([
    ['null', null],
    ['a number', 5],
    ['teams as an array', { teams: [], qualsComplete: true, rpMethod: 'none' }],
    ['an unknown rpMethod', { teams: {}, qualsComplete: true, rpMethod: 'guess' }],
    ['an unknown line category', { teams: { frc1: { teamKey: 'frc1', total: 1, lines: [{ category: 'bribe', label: 'x', points: 1 }] } }, qualsComplete: true, rpMethod: 'none' }],
    ['a non-number total', { teams: { frc1: { teamKey: 'frc1', total: '1', lines: [] } }, qualsComplete: true, rpMethod: 'none' }],
  ])('rejects %s', (_label, raw) => {
    expect(deserializeEventScores(raw)).toBeNull();
  });
});

describe('eventInfo / parseEventInfo', () => {
  it('collects nicknames and whether TBA has matches and rankings yet', () => {
    const data = {
      ...emptyEvent(),
      teams: [
        { key: 'frc1', team_number: 1, nickname: 'One' },
        { key: 'frc2', team_number: 2, nickname: null },
      ],
      rankings: rankings([rankRow(1, 'frc1', [1, 0, 0])]),
      matches: [match({ num: 1, red: ['frc1'], blue: ['frc2'], redScore: 5, blueScore: 1 })],
    };
    expect(eventInfo(data)).toEqual({ teamNames: { frc1: 'One' }, hasEventData: true, hasRankings: true });
    expect(eventInfo(emptyEvent())).toEqual({ teamNames: {}, hasEventData: false, hasRankings: false });
  });

  it('parses a stored info object and rejects junk', () => {
    const info = { teamNames: { frc1: 'One' }, hasEventData: true, hasRankings: false };
    expect(parseEventInfo(JSON.parse(JSON.stringify(info)))).toEqual(info);
    expect(parseEventInfo({})).toBeNull();
    expect(parseEventInfo(null)).toBeNull();
  });
});
```

Create `tests/tba/eventDeps.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CacheRow } from '@/lib/db/types';
import type { CacheStore } from '@/lib/tba/client';
import { loadEventData } from '@/lib/tba/event';

describe('loadEventData deps', () => {
  it('passes store, fetch, clock, and key through to getTba', async () => {
    const rows = new Map<string, CacheRow>();
    const store: CacheStore = {
      getCache: async (p) => rows.get(p) ?? null,
      upsertCache: async (r) => {
        rows.set(r.path, r);
      },
    };
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response('[]', { status: 200, headers: { etag: '"a"' } });
    }) as typeof fetch;

    const loaded = await loadEventData(
      '2099test',
      { windowMs: 60_000 },
      { store, fetchImpl, apiKey: 'k', now: () => new Date('2026-10-24T12:00:00.000Z') },
    );

    expect(urls).toHaveLength(6);
    expect(rows.size).toBe(6);
    expect(loaded.fetchedAt).toBe('2026-10-24T12:00:00.000Z');
    expect(loaded.stale).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/scores/serialize.test.ts tests/tba/eventDeps.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/scores/serialize"` and, for the deps test, `urls` has length 0 or a missing `TBA_API_KEY` stale result (the deps are ignored today).

- [ ] **Step 3: Create `lib/tba/clean.ts`**

Move `isObject`, `objects`, `NO_EVENT_DATA`, and `cleanEventData` out of `lib/views/round.ts` **unchanged**, and add `EventInfo` / `eventInfo`:

```ts
import type {
  Alliance,
  Award,
  EventData,
  MatchSimple,
  RankingRow,
  RankingsResponse,
  TeamSimple,
} from '@/lib/tba/types';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const objects = <T>(v: unknown): T[] | null => (Array.isArray(v) ? (v.filter(isObject) as T[]) : null);

export const NO_EVENT_DATA: EventData = {
  teams: null,
  matches: null,
  rankings: null,
  alliances: null,
  awards: null,
  oprs: null,
};

/** TBA is trusted but not blindly: a section (or row) with the wrong shape is treated as "no data". */
export function cleanEventData(data: EventData): EventData {
  const rankings: unknown = data.rankings;
  const oprs: unknown = data.oprs;
  const rankingRows = isObject(rankings) ? objects<RankingRow>(rankings.rankings) : null;
  return {
    teams: objects<TeamSimple>(data.teams),
    matches: objects<MatchSimple>(data.matches),
    rankings: isObject(rankings) && rankingRows ? { ...(rankings as RankingsResponse), rankings: rankingRows } : null,
    alliances: objects<Alliance>(data.alliances),
    awards: objects<Award>(data.awards),
    oprs: isObject(oprs) && isObject(oprs.oprs) ? (oprs as EventData['oprs']) : null,
  };
}

/** What the round page shows besides scores. Stored next to cached scores so a cache hit needs no TBA bodies. */
export type EventInfo = {
  /** teamKey -> nickname, for teams TBA knows about. */
  teamNames: Record<string, string>;
  /** False until TBA has at least one match or ranking for the event. */
  hasEventData: boolean;
  hasRankings: boolean;
};

/** Expects cleaned data (cleanEventData). */
export function eventInfo(data: EventData): EventInfo {
  const teamNames: Record<string, string> = {};
  for (const t of data.teams ?? []) if (t.nickname) teamNames[t.key] = t.nickname;
  const rankingCount = Array.isArray(data.rankings?.rankings) ? data.rankings.rankings.length : 0;
  return {
    teamNames,
    hasEventData: (data.matches?.length ?? 0) > 0 || rankingCount > 0,
    hasRankings: rankingCount > 0,
  };
}
```

In `lib/views/round.ts`: delete the moved code (`isObject`, `objects`, `NO_EVENT_DATA`, `cleanEventData`) and the now-unused TBA type imports, and add:

```ts
import { cleanEventData, NO_EVENT_DATA } from '@/lib/tba/clean';

// Kept so existing imports (tests/views/views.test.ts) keep working.
export { cleanEventData } from '@/lib/tba/clean';
```

(`buildRoundView` still uses both until Task 7 replaces its body.)

- [ ] **Step 4: Give `loadEventData` an optional deps argument**

In `lib/tba/event.ts`, change the import to `import { getTba, type TbaDeps } from '@/lib/tba/client';` and the function to:

```ts
/** Fetches everything the scoring engine needs for one event, in parallel. `deps` is for scripts and tests. */
export async function loadEventData(
  eventKey: string,
  opts: { windowMs: number; force?: boolean },
  deps?: Partial<TbaDeps>,
): Promise<LoadedEvent> {
  const paths = eventPaths(eventKey);
  const names = Object.keys(paths) as (keyof EventData)[];
  // Only pass deps when given, so existing call expectations (path, opts) stay exact.
  const results = await Promise.all(
    names.map((name) => (deps ? getTba<unknown>(paths[name], opts, deps) : getTba<unknown>(paths[name], opts))),
  );

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

- [ ] **Step 5: Create `lib/scores/serialize.ts`**

The two `Record<…, true>` objects make TypeScript fail here if someone adds a `CategoryId` or `RpMethod` (SP2 adds `'manual'`) without updating the validator.

```ts
import { z } from 'zod';
import type { CategoryId, EventScores, Line, RpMethod, TeamScore } from '@/lib/scoring/types';
import type { EventInfo } from '@/lib/tba/clean';

const CATEGORIES: Record<CategoryId, true> = {
  qualRecord: true,
  rankingPoints: true,
  rank: true,
  alliance: true,
  playoffWins: true,
  eventResult: true,
  awards: true,
  oprBonus: true,
  adjustment: true,
};

const RP_METHODS: Record<RpMethod, true> = {
  extra_stats: true,
  sort_order_avg: true,
  none: true,
};

const lineSchema = z.object({
  category: z.string().refine((c) => c in CATEGORIES),
  label: z.string(),
  quantity: z.number().optional(),
  points: z.number(),
});

const serializedSchema = z.object({
  teams: z.record(
    z.string(),
    z.object({ teamKey: z.string(), total: z.number(), lines: z.array(lineSchema) }),
  ),
  qualsComplete: z.boolean(),
  rpMethod: z.string().refine((m) => m in RP_METHODS),
});

const infoSchema = z.object({
  teamNames: z.record(z.string(), z.string()),
  hasEventData: z.boolean(),
  hasRankings: z.boolean(),
});

/** event_scores.scores (spec §5.6): EventScores with the teams Map written as a plain object. */
export type SerializedEventScores = {
  teams: Record<string, TeamScore>;
  qualsComplete: boolean;
  rpMethod: RpMethod;
};

export function serializeEventScores(s: EventScores): SerializedEventScores {
  return { teams: Object.fromEntries(s.teams), qualsComplete: s.qualsComplete, rpMethod: s.rpMethod };
}

/** Null when the stored JSON has the wrong shape; the caller then treats it as a cache miss. */
export function deserializeEventScores(raw: unknown): EventScores | null {
  const parsed = serializedSchema.safeParse(raw);
  if (!parsed.success) return null;
  const teams = new Map<string, TeamScore>();
  for (const [key, t] of Object.entries(parsed.data.teams)) {
    teams.set(key, { teamKey: t.teamKey, total: t.total, lines: t.lines as Line[] });
  }
  return { teams, qualsComplete: parsed.data.qualsComplete, rpMethod: parsed.data.rpMethod as RpMethod };
}

export function parseEventInfo(raw: unknown): EventInfo | null {
  const parsed = infoSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/scores tests/tba tests/views`
Expected: all PASS, including the untouched `cleanEventData` tests in `tests/views/views.test.ts` and `tests/tba/event.test.ts`.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add lib/tba/clean.ts lib/tba/event.ts lib/views/round.ts lib/scores/serialize.ts tests/scores/serialize.test.ts tests/tba/eventDeps.test.ts
git commit -m "feat(sp3): EventScores serializer, eventInfo, cleanEventData moved to lib/tba/clean"
```

---

### Task 6: `getEventScores` — the read-through cache

**Files:**
- Create: `lib/scores/eventScores.ts`
- Test: `tests/scores/eventScores.test.ts`

**Interfaces:**
- Consumes: `getCacheMeta`, `getEventScoresRow`, `upsertEventScoresRow` (Tasks 3–4); `configHash`, `sourceStamp` (Task 2); `cleanEventData`, `eventInfo`, `NO_EVENT_DATA`, `EventInfo`, serializers, `loadEventData(…, deps)` (Task 5); v1 `scoreEvent`, `eventPaths`.
- Produces (contract name, plus `info` and `opts` — see Deviation 2):
  ```ts
  export type EventScoresResult = { scores: EventScores; info: EventInfo; stale: boolean; fetchedAt: string | null };
  export type EventScoresOptions = { now?: Date; repo?: Repo; tba?: Partial<TbaDeps> };
  export async function getEventScores(eventKey: string, config: ScoringConfig, windowMs: number, opts?: EventScoresOptions): Promise<EventScoresResult>;
  export { serializeEventScores, deserializeEventScores } from '@/lib/scores/serialize';
  ```
  SP2 calls this per event of a season round, with that event's own cache window (spec §5.5).

- [ ] **Step 1: Write the failing test**

Create `tests/scores/eventScores.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ scoreCalls: 0, throwOnce: false }));
vi.mock('@/lib/db', () => ({
  getRepo: () => {
    throw new Error('tests pass the repo explicitly');
  },
}));
vi.mock('@/lib/scoring/engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/scoring/engine')>();
  return {
    ...real,
    scoreEvent: (...args: Parameters<typeof real.scoreEvent>) => {
      h.scoreCalls += 1;
      if (h.throwOnce) {
        h.throwOnce = false;
        throw new Error('boom');
      }
      return real.scoreEvent(...args);
    },
  };
});

import type { Repo } from '@/lib/db/repo';
import { defaultScoring, type ScoringConfig } from '@/lib/scoring/config';
import { configHash } from '@/lib/scores/hash';
import { getEventScores } from '@/lib/scores/eventScores';
import { cleanEventData } from '@/lib/tba/clean';
import type { EventData } from '@/lib/tba/types';
import { emptyEvent, match, rankRow, rankings } from '../helpers/builders';
import { createMemoryRepo } from '../helpers/memoryRepo';

const { scoreEvent: realScore } = await vi.importActual<typeof import('@/lib/scoring/engine')>(
  '@/lib/scoring/engine',
);

const EVENT = '2099test';
const WINDOW = 60_000;
const RED = ['frc1', 'frc2', 'frc3'];
const BLUE = ['frc4', 'frc5', 'frc6'];

function eventData(redScore: number): EventData {
  return {
    ...emptyEvent(),
    teams: [...RED, ...BLUE].map((key) => ({ key, team_number: Number(key.slice(3)), nickname: `Team ${key.slice(3)}` })),
    rankings: rankings([rankRow(1, 'frc1', [1, 0, 0], { extra_stats: [3] }), rankRow(2, 'frc4', [0, 1, 0], { extra_stats: [0] })]),
    matches: [match({ num: 1, red: RED, blue: BLUE, redScore, blueScore: 10 })],
  };
}

/** A fake TBA: serves `data` per endpoint, answers 304 for a matching ETag, can go offline. */
function fakeTba(initial: EventData | null) {
  let data = initial;
  let version = 1;
  let down = false;
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    if (down || data === null) throw new Error('offline');
    const m = /\/event\/[^/]+\/(teams|matches|rankings|alliances|awards|oprs)/.exec(u);
    const etag = `"v${version}"`;
    if (new Headers(init?.headers).get('If-None-Match') === etag) return new Response(null, { status: 304 });
    return new Response(JSON.stringify(data[m![1] as keyof EventData]), { status: 200, headers: { etag } });
  }) as typeof fetch;
  return {
    fetchImpl,
    calls,
    change(next: EventData) {
      data = next;
      version += 1;
    },
    setDown(v: boolean) {
      down = v;
    },
  };
}

let repo: Repo;
let now: Date;
let tba: ReturnType<typeof fakeTba>;
let getCacheCalls: number;

function run(config: ScoringConfig = defaultScoring()) {
  return getEventScores(EVENT, config, WINDOW, {
    now,
    repo,
    tba: { fetchImpl: tba.fetchImpl, apiKey: 'k', now: () => now },
  });
}
const later = (ms: number) => {
  now = new Date(now.getTime() + ms);
};

beforeEach(() => {
  const inner = createMemoryRepo();
  getCacheCalls = 0;
  // Count body reads: getCache returns the full row including the TBA body.
  repo = {
    ...inner,
    getCache: (path) => {
      getCacheCalls += 1;
      return inner.getCache(path);
    },
  };
  now = new Date('2026-10-24T12:00:00.000Z');
  tba = fakeTba(eventData(50));
  h.scoreCalls = 0;
  h.throwOnce = false;
});

describe('getEventScores', () => {
  it('on a first view: fetches TBA, scores, and caches the result', async () => {
    const res = await run();
    expect(tba.calls).toHaveLength(6);
    expect(res.scores).toEqual(realScore(cleanEventData(eventData(50)), defaultScoring()));
    expect(res.info.teamNames.frc1).toBe('Team 1');
    expect(res.stale).toBe(false);
    expect(res.fetchedAt).toBe('2026-10-24T12:00:00.000Z');
    expect(await repo.getEventScoresRow(EVENT, configHash(defaultScoring()))).not.toBeNull();
  });

  it('within the window: returns the cached scores without reading TBA bodies or re-scoring', async () => {
    const first = await run();
    tba.calls.length = 0;
    getCacheCalls = 0;
    h.scoreCalls = 0;
    later(30_000);

    const second = await run();
    expect(tba.calls).toHaveLength(0);
    expect(getCacheCalls).toBe(0);
    expect(h.scoreCalls).toBe(0);
    expect(second.scores).toEqual(first.scores);
    expect(second.info).toEqual(first.info);
    expect(second.fetchedAt).toBe('2026-10-24T12:00:00.000Z');
  });

  it('after the window, a 304 keeps the stamp, so nothing is re-scored', async () => {
    await run();
    const before = await repo.getEventScoresRow(EVENT, configHash(defaultScoring()));
    h.scoreCalls = 0;
    later(2 * WINDOW);

    const res = await run();
    expect(tba.calls).toHaveLength(12); // six more requests, all answered 304
    expect(h.scoreCalls).toBe(0);
    expect(res.fetchedAt).toBe(now.toISOString());
    expect((await repo.getEventScoresRow(EVENT, configHash(defaultScoring())))?.computedAt).toBe(before?.computedAt);
  });

  it('after the window, changed TBA data is re-scored and the row replaced', async () => {
    await run();
    later(2 * WINDOW);
    tba.change(eventData(5)); // blue now wins match 1

    const res = await run();
    expect(res.scores).toEqual(realScore(cleanEventData(eventData(5)), defaultScoring()));
    expect(res.scores).not.toEqual(realScore(cleanEventData(eventData(50)), defaultScoring()));
    const row = await repo.getEventScoresRow(EVENT, configHash(defaultScoring()));
    expect(row?.computedAt).toBe(now.toISOString());
  });

  it('keeps a separate row per scoring config', async () => {
    const custom = defaultScoring();
    custom.qualWin = 100;
    const a = await run();
    const b = await run(custom);
    expect(b.scores.teams.get('frc1')!.total).toBeGreaterThan(a.scores.teams.get('frc1')!.total);
    expect(await repo.getEventScoresRow(EVENT, configHash(custom))).not.toBeNull();
    expect(await repo.getEventScoresRow(EVENT, configHash(defaultScoring()))).not.toBeNull();
  });

  // Review Focus 2.
  it('when TBA has never answered: empty scores, marked stale, nothing cached, tries again next time', async () => {
    tba = fakeTba(null);
    const res = await run();
    expect(res.scores.teams.size).toBe(0);
    expect(res.stale).toBe(true);
    expect(res.fetchedAt).toBeNull();
    expect(await repo.getEventScoresRow(EVENT, configHash(defaultScoring()))).toBeNull();

    tba.calls.length = 0;
    await run();
    expect(tba.calls).toHaveLength(6);
  });

  it('when TBA goes down after a good fetch: serves the cached scores, marked stale', async () => {
    const good = await run();
    later(2 * WINDOW);
    tba.setDown(true);
    const res = await run();
    expect(res.stale).toBe(true);
    expect(res.scores).toEqual(good.scores);
  });

  it('if scoring throws: empty scores, stale, and the failure is not cached', async () => {
    h.throwOnce = true;
    const res = await run();
    expect(res.scores.teams.size).toBe(0);
    expect(res.stale).toBe(true);
    expect(await repo.getEventScoresRow(EVENT, configHash(defaultScoring()))).toBeNull();

    const retry = await run();
    expect(retry.scores.teams.size).toBe(6);
  });

  it('treats a corrupt cached row as a miss and replaces it', async () => {
    await run();
    const hash = configHash(defaultScoring());
    const row = await repo.getEventScoresRow(EVENT, hash);
    await repo.upsertEventScoresRow({ ...row!, scores: { teams: 'broken' } });
    h.scoreCalls = 0;

    const res = await run();
    expect(h.scoreCalls).toBe(1);
    expect(res.scores.teams.size).toBe(6);
    expect((await repo.getEventScoresRow(EVENT, hash))?.scores).not.toEqual({ teams: 'broken' });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/scores/eventScores.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/scores/eventScores"`.

- [ ] **Step 3: Implement**

Create `lib/scores/eventScores.ts`:

```ts
import { getRepo } from '@/lib/db';
import type { Repo } from '@/lib/db/repo';
import type { CacheMeta, EventScoresRow } from '@/lib/db/types';
import type { ScoringConfig } from '@/lib/scoring/config';
import { scoreEvent } from '@/lib/scoring/engine';
import type { EventScores } from '@/lib/scoring/types';
import { configHash, sourceStamp } from '@/lib/scores/hash';
import { deserializeEventScores, parseEventInfo, serializeEventScores } from '@/lib/scores/serialize';
import { cleanEventData, eventInfo, NO_EVENT_DATA, type EventInfo } from '@/lib/tba/clean';
import type { TbaDeps } from '@/lib/tba/client';
import { eventPaths, loadEventData } from '@/lib/tba/event';

export { deserializeEventScores, serializeEventScores } from '@/lib/scores/serialize';

export type EventScoresResult = {
  scores: EventScores;
  info: EventInfo;
  /** Same meaning as v1: true when TBA couldn't be refreshed and older data is shown. */
  stale: boolean;
  /** The oldest fetch among the six TBA paths: the honest "last updated". */
  fetchedAt: string | null;
};

export type EventScoresOptions = {
  now?: Date;
  /** Defaults to getRepo(); scripts and tests pass their own. Also used as the TBA cache store. */
  repo?: Repo;
  /** Passed through to getTba (fetch, clock, API key) — for scripts (throttling) and tests. */
  tba?: Partial<TbaDeps>;
};

function toMap(meta: CacheMeta[]): Map<string, CacheMeta> {
  return new Map(meta.map((m) => [m.path, m]));
}

function oldest(meta: CacheMeta[]): string | null {
  const times = meta.map((m) => m.fetchedAt).sort();
  return times[0] ?? null;
}

function fromRow(row: EventScoresRow | null): { scores: EventScores; info: EventInfo } | null {
  if (!row) return null;
  const scores = deserializeEventScores(row.scores);
  const info = parseEventInfo(row.info);
  return scores && info ? { scores, info } : null;
}

/**
 * Scores for one event under one scoring config, through the derived event_scores cache (spec §5.6).
 * A hit reads only tba_cache metadata and the stored row — no TBA bodies, no scoreEvent.
 * The cache is rebuildable: deleting every row only costs one re-score per event.
 */
export async function getEventScores(
  eventKey: string,
  config: ScoringConfig,
  windowMs: number,
  opts: EventScoresOptions = {},
): Promise<EventScoresResult> {
  const repo = opts.repo ?? getRepo();
  const now = opts.now ?? new Date();
  const paths = Object.values(eventPaths(eventKey)); // fixed order: the stamp depends on it
  const cfgHash = configHash(config);

  // Steps 2–3: metadata only.
  const [meta, stored] = await Promise.all([repo.getCacheMeta(paths), repo.getEventScoresRow(eventKey, cfgHash)]);
  const stamp = sourceStamp(paths, toMap(meta));
  const allFresh = meta.length === paths.length && meta.every((m) => now.getTime() - Date.parse(m.fetchedAt) < windowMs);
  if (stamp !== null && allFresh && stored?.sourceStamp === stamp) {
    const cached = fromRow(stored);
    if (cached) return { ...cached, stale: false, fetchedAt: oldest(meta) };
  }

  // Step 4: refresh through getTba exactly as v1 does (304s keep body_hash, so the stamp stays put).
  const loaded = await loadEventData(eventKey, { windowMs }, { store: repo, ...opts.tba });
  const data = cleanEventData(loaded.data);
  const info = eventInfo(data);
  const newStamp = sourceStamp(paths, toMap(await repo.getCacheMeta(paths)));

  if (newStamp !== null && stored?.sourceStamp === newStamp) {
    const cached = fromRow(stored);
    if (cached) return { scores: cached.scores, info, stale: loaded.stale, fetchedAt: loaded.fetchedAt };
  }

  let scores: EventScores;
  try {
    scores = scoreEvent(data, config);
  } catch (err) {
    // One malformed payload must not take a page down; the failure is not cached.
    console.error(`Scoring failed for ${eventKey}; falling back to empty data`, err);
    return { scores: scoreEvent(NO_EVENT_DATA, config), info, stale: true, fetchedAt: loaded.fetchedAt };
  }

  // No stamp = some path has never been cached (TBA never answered): don't cache a guess.
  if (newStamp !== null) {
    try {
      await repo.upsertEventScoresRow({
        eventKey,
        configHash: cfgHash,
        sourceStamp: newStamp,
        scores: serializeEventScores(scores),
        info,
        computedAt: now.toISOString(),
      });
    } catch (err) {
      // A cache write failure costs a re-score next time; it must not fail the page.
      console.error(`Could not cache scores for ${eventKey}`, err);
    }
  }
  return { scores, info, stale: loaded.stale, fetchedAt: loaded.fetchedAt };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/scores/eventScores.test.ts`
Expected: 9 PASS.

If "a 304 keeps the stamp" fails with `scoreCalls` = 1: check that `upsertCache` computes the hash from the body (Task 3) and that `getTba`'s 304 branch re-saves `row.body` — both repos must hash the *canonical* JSON.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add lib/scores/eventScores.ts tests/scores/eventScores.test.ts
git commit -m "feat(sp3): getEventScores read-through cache over scoreEvent"
```

---

### Task 7: Round and league views read through `getEventScores` + the `2025parr` replay

**Files:**
- Modify: `lib/views/round.ts` (`buildRoundView` body)
- Modify: `tests/config/dynamic-exports.test.ts` (add `getEventScores` to `TBA_USERS`)
- Test: `tests/scores/replay-2025parr.test.ts`

**Interfaces:**
- Consumes: `getEventScores` (Task 6). `RoundView`'s shape does not change, so the league view (`lib/views/league.ts`, which calls `buildRoundView`) and every page are untouched.
- Produces: nothing new; the spec §5.6 replay guarantee.

- [ ] **Step 1: Write the failing replay test**

Create `tests/scores/replay-2025parr.test.ts`. It serves the real `2025parr` fixture through a fake `fetch`, so the whole path (`getTba` → `tba_cache` → `getEventScores` → `event_scores` → `buildRoundView`) runs for real against the in-memory repo.

```ts
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));

import type { Repo } from '@/lib/db/repo';
import type { PlayerRow } from '@/lib/db/types';
import { DEFAULT_SCORING, defaultScoring } from '@/lib/scoring/config';
import { scoreEvent } from '@/lib/scoring/engine';
import { roundPlayers, scoreRound } from '@/lib/scoring/round';
import { getEventScores } from '@/lib/scores/eventScores';
import { cleanEventData } from '@/lib/tba/clean';
import type { EventData } from '@/lib/tba/types';
import { buildRoundView } from '@/lib/views/round';
import { seedLeague } from '../helpers/api';
import { loadFixture } from '../helpers/fixture';
import { createMemoryRepo } from '../helpers/memoryRepo';

const NOW = new Date('2026-10-01T16:00:00.000Z');
const fixture = loadFixture('2025parr');
const SUFFIX: Record<string, keyof EventData> = {
  'teams/simple': 'teams',
  'matches/simple': 'matches',
  rankings: 'rankings',
  alliances: 'alliances',
  awards: 'awards',
  oprs: 'oprs',
};

let repo: Repo;
let calls: string[];
let getCacheCalls: number;
const fetchImpl = (async (url: string | URL | Request) => {
  const u = String(url);
  calls.push(u);
  const name = SUFFIX[/\/event\/2025parr\/(.+)$/.exec(u)![1]];
  return new Response(JSON.stringify(fixture[name]), { status: 200, headers: { etag: '"fixture"' } });
}) as typeof fetch;

beforeEach(() => {
  const inner = createMemoryRepo();
  getCacheCalls = 0;
  repo = {
    ...inner,
    getCache: (p) => {
      getCacheCalls += 1;
      return inner.getCache(p);
    },
  };
  h.repo = repo;
  calls = [];
  vi.stubGlobal('fetch', fetchImpl);
  vi.stubEnv('TBA_API_KEY', 'test-key');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const expected = scoreEvent(cleanEventData(fixture), DEFAULT_SCORING);

describe('2025parr replay through getEventScores (spec §5.6)', () => {
  it('equals v1 scoreEvent output on a miss and on a hit', async () => {
    const miss = await getEventScores('2025parr', DEFAULT_SCORING, 10 * 60_000, { now: NOW });
    expect(calls).toHaveLength(6);
    expect(miss.scores).toEqual(expected);

    getCacheCalls = 0;
    const hit = await getEventScores('2025parr', DEFAULT_SCORING, 10 * 60_000, { now: NOW });
    expect(calls).toHaveLength(6); // no new TBA requests
    expect(getCacheCalls).toBe(0); // no TBA bodies read
    expect(hit.scores).toEqual(expected);
    expect(hit.info.teamNames.frc2607).toBeTruthy();
    expect(Object.keys(hit.info.teamNames)).toHaveLength(34);
  });

  it('gives the round page exactly the v1 player scores', async () => {
    const { league } = await seedLeague(repo);
    const players: PlayerRow[] = [];
    for (const name of ['Mom', 'Dad']) {
      players.push(await repo.createMember({ leagueId: league.id, userId: randomUUID(), name, role: 'player' }));
    }
    let round = await repo.createRound({
      leagueId: league.id,
      eventKey: '2025parr',
      eventName: 'Ramp Riot XXV',
      startDate: '2025-10-18',
      endDate: '2025-10-18',
      timezone: 'America/New_York',
      scoring: defaultScoring(),
    });
    round = await repo.updateRound(round.id, { draftOrder: players.map((p) => p.id), rosterSize: 2 });
    // Snake: Mom, Dad, Dad, Mom. Winner captain, finalist captain, OPR #2, a third pick.
    const teams = ['frc2607', 'frc316', 'frc9015', 'frc9991'];
    for (let n = 0; n < teams.length; n++) {
      await repo.insertPick({ roundId: round.id, pickNumber: n, playerId: [0, 1, 1, 0].map((i) => players[i].id)[n], teamKey: teams[n] });
    }
    const picks = await repo.listPicks(round.id);

    const view = await buildRoundView(round, players, picks, [], NOW);

    expect(view.scores).toEqual(scoreRound(expected.teams, picks, [], roundPlayers(players, round.draftOrder, [])));
    expect(view.qualsComplete).toBe(true);
    expect(view.rpMethod).toBe('extra_stats');
    expect(view.hasRankings).toBe(true);
    expect(view.stale).toBe(false);
    // The page went through the cache, so the next view is a cheap hit.
    expect(await repo.getEventScoresRow('2025parr', configHash(DEFAULT_SCORING))).not.toBeNull();
  });
});
```

Also add `import { configHash } from '@/lib/scores/hash';` to the imports.

If SP4 made `auto` a required field of `NewPick`, add `auto: false` to the `insertPick` call. If SP1 kept `createPlayer` instead of (or beside) `createMember`, either works here; the rows only need ids and names.

- [ ] **Step 2: Run it to make sure the round-page test fails**

Run: `npx vitest run tests/scores/replay-2025parr.test.ts`
Expected: the first test PASSES (Task 6 already works). The second FAILS on the last assertion (`expected null not to be null`): today `buildRoundView` still calls `loadEventData` + `scoreEvent` directly, so nothing is cached.

- [ ] **Step 3: Switch `buildRoundView` to `getEventScores`**

In `lib/views/round.ts`, replace the imports of `loadEventData`, `scoreEvent`, `NO_EVENT_DATA` with:

```ts
import { getEventScores } from '@/lib/scores/eventScores';
```

and replace the body of `buildRoundView` (keep the `status:` line exactly as SP4 left it if SP4 changed it — for example to pass `draftStartedAt`):

```ts
export async function buildRoundView(
  round: RoundRow,
  allPlayers: PlayerRow[],
  picks: PickRow[],
  adjustments: AdjustmentRow[],
  now: Date,
): Promise<RoundView> {
  // Scores come through the derived event_scores cache (spec §5.6); failures degrade to empty + stale inside it.
  const event = await getEventScores(round.eventKey, round.scoring, cacheWindowFor(round, now), { now });
  const players = roundPlayers(allPlayers, round.draftOrder, adjustments);
  return {
    round,
    status: roundStatus(round, picks.length, now),
    scores: scoreRound(event.scores.teams, picks, adjustments, players),
    picks,
    adjustments,
    teamNames: event.info.teamNames,
    qualsComplete: event.scores.qualsComplete,
    rpMethod: event.scores.rpMethod,
    hasEventData: event.info.hasEventData,
    hasRankings: event.info.hasRankings,
    fetchedAt: event.fetchedAt,
    stale: event.stale,
  };
}
```

Remove the now-unused `NO_EVENT_DATA` import from `lib/tba/clean` in this file (the `cleanEventData` re-export stays).

- [ ] **Step 4: Teach the dynamic-exports test about the new loader**

In `tests/config/dynamic-exports.test.ts`, extend the regex so any page or route that calls `getEventScores` directly must also export `maxDuration = 30`:

```ts
const TBA_USERS = /\b(getTba|loadPool|loadEventData|getEventScores|loadRoundPage|loadLeaguePage|roundDetail|buildRoundView)\b/;
```

- [ ] **Step 5: Run everything**

Run: `npm test`
Expected: all PASS — the new replay tests, and the untouched `tests/views/views.test.ts` (its `getTba` mock doesn't write `tba_cache`, so `getEventScores` sees no metadata, scores directly, and caches nothing — the same behavior as v1).

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add lib/views/round.ts tests/config/dynamic-exports.test.ts tests/scores/replay-2025parr.test.ts
git commit -m "feat(sp3): round and league views read scores through getEventScores; 2025parr replay"
```

---

### Task 8: `scripts/rebuild-event-scores.ts` — prove the cache is disposable

**Files:**
- Create: `scripts/rebuild-event-scores.ts`
- Test: `tests/scores/rebuild.test.ts`

**Interfaces:**
- Consumes: `clearEventScores` (Task 4), `buildRoundView` (Task 7).
- Produces: the script (README entry in Task 18).

- [ ] **Step 1: Write the failing test**

Create `tests/scores/rebuild.test.ts`. It's the spec's "truncate it and nothing breaks" rule as a test: clearing the cache between two page loads changes nothing the page shows.

```ts
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
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/scores/rebuild.test.ts`
Expected: PASS already (Tasks 4 and 6 did the work). This test is a guard: if anyone later makes a page depend on a row existing, it fails.

- [ ] **Step 3: Write the script**

Create `scripts/rebuild-event-scores.ts`:

```ts
// Empties the derived event_scores cache. Safe at any time: pages and the cron re-score events on demand.
// Use it after changing scoring code (lib/scoring/*), since cached rows were computed by the old code.
// Usage: npx tsx --env-file=.env.local scripts/rebuild-event-scores.ts
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';

async function main() {
  const repo = createSupabaseRepo(createSupabaseClient());
  const deleted = await repo.clearEventScores();
  console.log(`Deleted ${deleted} event_scores rows. They refill on the next page views and cron run.`);
  console.log('team_stats was not touched; rerun scripts/build-team-stats.ts <season> to recompute it.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 4: Typecheck and commit**

```bash
npm run typecheck
git add scripts/rebuild-event-scores.ts tests/scores/rebuild.test.ts
git commit -m "feat(sp3): rebuild-event-scores script; test that the cache is disposable"
```

> **Important for later:** any change to `lib/scoring/*` after SP3 must be followed by `rebuild-event-scores` on production, because cached rows hold the old code's output (the config hash covers config changes, not code changes). Task 18 puts this in the README.

---

### Task 9: Projection math and the per-event summarizer

**Files:**
- Create: `lib/stats/projection.ts`, `lib/stats/summarize.ts`
- Test: `tests/stats/projection.test.ts`, `tests/stats/summarize.test.ts`

**Interfaces:**
- Consumes: v1 `hasResult` (`lib/scoring/matches.ts`), `allianceMembers`, `finalsResult` (`lib/scoring/playoffs.ts`), `qualRecords` (`lib/scoring/quals.ts`), `DEFAULT_SCORING`; `BestFinish`, `TeamStatsAward` (Task 1).
- Produces:
  ```ts
  // lib/stats/projection.ts (contract name)
  export type SeasonTotals = { points: number; events: number };
  export function projection(cur: SeasonTotals | null, prev: SeasonTotals | null): number | null;
  // lib/stats/summarize.ts
  export type TeamEventSummary = {
    teamKey: string; eventKey: string; name: string; endDate: string;
    playedQuals: number; wins: number; losses: number; ties: number;
    rank: number | null; finish: BestFinish | null; points: number; opr: number | null;
    awards: TeamStatsAward[];
  };
  export const FINISH_ORDER: BestFinish[];                 // ['winner', 'finalist', 'captain', 'picked']
  export function betterFinish(a: BestFinish | null, b: BestFinish | null): BestFinish | null;
  export function summarizeEvent(event: TbaEvent, data: EventData, scores: EventScores): TeamEventSummary[];
  ```
  `summarizeEvent` expects cleaned data (`cleanEventData`) and default-config scores. It returns one summary per team with **≥ 1 played qual match**, sorted by team key.

- [ ] **Step 1: Write the failing projection test**

Create `tests/stats/projection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { projection } from '@/lib/stats/projection';

describe('projection (spec §6.1)', () => {
  it('weights the draft season twice as much as the season before', () => {
    // (2 × 40 + 30) / (2 × 2 + 1) = 110 / 5
    expect(projection({ points: 40, events: 2 }, { points: 30, events: 1 })).toBe(22);
  });

  it('uses whichever season exists', () => {
    expect(projection({ points: 80, events: 2 }, null)).toBe(40);
    expect(projection(null, { points: 90, events: 3 })).toBe(30);
  });

  it('rounds to one decimal', () => {
    expect(projection({ points: 10, events: 3 }, null)).toBe(3.3);
    expect(projection({ points: 0, events: 0 }, { points: 101, events: 3 })).toBe(33.7);
  });

  it('is null ("New") when no events were played in either season', () => {
    expect(projection(null, null)).toBeNull();
    expect(projection({ points: 0, events: 0 }, { points: 0, events: 0 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails, then implement**

Run: `npx vitest run tests/stats/projection.test.ts` → FAIL (`Failed to resolve import "@/lib/stats/projection"`).

Create `lib/stats/projection.ts`:

```ts
export type SeasonTotals = { points: number; events: number };

/**
 * Projected fantasy points per event for a draft in season Y (spec §6.1):
 * (2 × points[Y] + points[Y−1]) / (2 × events[Y] + events[Y−1]), rounded to 1 decimal.
 * A missing season counts as 0 points over 0 events. Null means "New" (no events at all).
 */
export function projection(cur: SeasonTotals | null, prev: SeasonTotals | null): number | null {
  const c = cur ?? { points: 0, events: 0 };
  const p = prev ?? { points: 0, events: 0 };
  const events = 2 * c.events + p.events;
  if (events <= 0) return null;
  return Math.round(((2 * c.points + p.points) / events) * 10) / 10;
}
```

Run: `npx vitest run tests/stats/projection.test.ts` → 4 PASS.

- [ ] **Step 3: Write the failing summarizer test**

Create `tests/stats/summarize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { scoreEvent } from '@/lib/scoring/engine';
import { allianceMembers } from '@/lib/scoring/playoffs';
import { betterFinish, summarizeEvent } from '@/lib/stats/summarize';
import { cleanEventData } from '@/lib/tba/clean';
import type { EventData, TbaEvent } from '@/lib/tba/types';
import { alliance, emptyEvent, match, rankRow, rankings } from '../helpers/builders';
import { loadFixture, loadFixtureEvent } from '../helpers/fixture';

const parr = cleanEventData(loadFixture('2025parr'));
const parrEvent = loadFixtureEvent('2025parr');
const parrScores = scoreEvent(parr, DEFAULT_SCORING);
const summaries = summarizeEvent(parrEvent, parr, parrScores);
const byTeam = new Map(summaries.map((s) => [s.teamKey, s]));

const synthetic = (key: string, extra: Partial<TbaEvent> = {}): TbaEvent => ({
  key,
  name: `Event ${key}`,
  start_date: '2026-03-14',
  end_date: '2026-03-16',
  timezone: 'America/New_York',
  event_type: 1,
  ...extra,
});

describe('summarizeEvent on Ramp Riot 2025', () => {
  it('covers every team that played a qual match, with the event facts attached', () => {
    expect(summaries.length).toBeGreaterThan(30);
    for (const s of summaries) {
      expect(s.playedQuals, s.teamKey).toBeGreaterThan(0);
      expect(s.eventKey).toBe('2025parr');
      expect(s.endDate).toBe('2025-10-18');
    }
  });

  it('knows the winner, the finalist, captains, and picks (Alliance 2 had 4 robots)', () => {
    expect(byTeam.get('frc2607')?.finish).toBe('winner'); // Alliance 3 captain
    expect(byTeam.get('frc1712')?.finish).toBe('winner');
    expect(byTeam.get('frc316')?.finish).toBe('finalist'); // Alliance 4 captain
    expect(byTeam.get('frc7414')?.finish).toBe('captain'); // Alliance 1, lost in playoffs
    expect(byTeam.get('frc341')?.finish).toBe('picked');
    expect(byTeam.get('frc9991')?.finish).toBe('picked'); // Alliance 2's fourth robot
  });

  it('leaves finish null for a team that was never on an alliance', () => {
    const onAlliance = new Set(parr.alliances!.flatMap(allianceMembers));
    const loner = summaries.find((s) => !onAlliance.has(s.teamKey));
    expect(loner, 'the fixture has unpicked teams').toBeDefined();
    expect(loner!.finish).toBeNull();
  });

  it('copies rank, record, OPR, and default-scoring points', () => {
    const t = byTeam.get('frc2607')!;
    expect(t.rank).toBe(3);
    expect([t.wins, t.losses, t.ties]).toEqual([5, 0, 0]);
    expect(t.opr).toBeCloseTo(89.459, 2);
    expect(t.points).toBe(parrScores.teams.get('frc2607')!.total);
  });
});

// Review Focus 3.
describe('events that must not count', () => {
  it('skips Einstein-style events with playoff matches but no quals', () => {
    const data: EventData = {
      ...emptyEvent(),
      alliances: [alliance(['frc1', 'frc2', 'frc3']), alliance(['frc4', 'frc5', 'frc6'])],
      matches: [
        match({ level: 'f', set: 1, num: 1, red: ['frc1', 'frc2', 'frc3'], blue: ['frc4', 'frc5', 'frc6'], redScore: 90, blueScore: 80 }),
        match({ level: 'f', set: 1, num: 2, red: ['frc1', 'frc2', 'frc3'], blue: ['frc4', 'frc5', 'frc6'], redScore: 90, blueScore: 80 }),
      ],
    };
    const ev = synthetic('2026cmptx', { event_type: 4 });
    expect(summarizeEvent(ev, data, scoreEvent(data, DEFAULT_SCORING))).toEqual([]);
  });

  it('skips teams whose qual matches are scheduled but not played', () => {
    const data: EventData = {
      ...emptyEvent(),
      matches: [match({ num: 1, red: ['frc1', 'frc2', 'frc3'], blue: ['frc4', 'frc5', 'frc6'] })], // no scores
      rankings: rankings([rankRow(1, 'frc1', null)]),
    };
    expect(summarizeEvent(synthetic('2026paca'), data, scoreEvent(data, DEFAULT_SCORING))).toEqual([]);
  });

  it('counts a team only for the qual matches that have a result', () => {
    const data: EventData = {
      ...emptyEvent(),
      matches: [
        match({ num: 1, red: ['frc1', 'frc2', 'frc3'], blue: ['frc4', 'frc5', 'frc6'], redScore: 10, blueScore: 5 }),
        match({ num: 2, red: ['frc1', 'frc2', 'frc3'], blue: ['frc4', 'frc5', 'frc6'] }),
      ],
    };
    const got = summarizeEvent(synthetic('2026paca'), data, scoreEvent(data, DEFAULT_SCORING));
    expect(got.find((s) => s.teamKey === 'frc1')?.playedQuals).toBe(1);
    expect(got.find((s) => s.teamKey === 'frc1')?.wins).toBe(1);
  });
});

describe('awards', () => {
  it('keeps team awards and skips the excluded types (Winner, Finalist, individual awards)', () => {
    const data: EventData = {
      ...emptyEvent(),
      matches: [match({ num: 1, red: ['frc1', 'frc2', 'frc3'], blue: ['frc4', 'frc5', 'frc6'], redScore: 10, blueScore: 5 })],
      awards: [
        { name: 'FIRST Impact Award', award_type: 0, recipient_list: [{ team_key: 'frc1', awardee: null }] },
        { name: 'Winner', award_type: 1, recipient_list: [{ team_key: 'frc1', awardee: null }] },
        { name: "Dean's List Finalist", award_type: 4, recipient_list: [{ team_key: 'frc1', awardee: 'Sam' }] },
      ],
    };
    const got = summarizeEvent(synthetic('2026paca'), data, scoreEvent(data, DEFAULT_SCORING));
    expect(got.find((s) => s.teamKey === 'frc1')?.awards).toEqual([
      { type: 0, name: 'FIRST Impact Award', eventKey: '2026paca' },
    ]);
  });
});

describe('betterFinish', () => {
  it('orders winner > finalist > captain > picked > none', () => {
    expect(betterFinish('picked', 'captain')).toBe('captain');
    expect(betterFinish('winner', 'finalist')).toBe('winner');
    expect(betterFinish(null, 'picked')).toBe('picked');
    expect(betterFinish(null, null)).toBeNull();
  });
});
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `npx vitest run tests/stats/summarize.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/stats/summarize"`.

- [ ] **Step 5: Implement the summarizer**

Create `lib/stats/summarize.ts`:

```ts
import type { BestFinish, TeamStatsAward } from '@/lib/db/types';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { hasResult } from '@/lib/scoring/matches';
import { allianceMembers, finalsResult } from '@/lib/scoring/playoffs';
import { qualRecords } from '@/lib/scoring/quals';
import type { EventScores } from '@/lib/scoring/types';
import type { EventData, TbaEvent } from '@/lib/tba/types';

/** One team at one event: the facts team_stats is built from. */
export type TeamEventSummary = {
  teamKey: string;
  eventKey: string;
  name: string;
  endDate: string;
  playedQuals: number;
  wins: number;
  losses: number;
  ties: number;
  rank: number | null;
  finish: BestFinish | null;
  /** Fantasy points under DEFAULT_SCORING. */
  points: number;
  opr: number | null;
  awards: TeamStatsAward[];
};

export const FINISH_ORDER: BestFinish[] = ['winner', 'finalist', 'captain', 'picked'];

export function betterFinish(a: BestFinish | null, b: BestFinish | null): BestFinish | null {
  if (a === null) return b;
  if (b === null) return a;
  return FINISH_ORDER.indexOf(a) <= FINISH_ORDER.indexOf(b) ? a : b;
}

/**
 * Per-team facts for one event (spec §6.1). Only teams with at least one PLAYED qual match are
 * returned, so Einstein (no quals) and events that haven't started are never counted.
 * Expects cleaned data (cleanEventData) and scores computed with DEFAULT_SCORING.
 */
export function summarizeEvent(event: TbaEvent, data: EventData, scores: EventScores): TeamEventSummary[] {
  const played = new Map<string, number>();
  for (const m of data.matches ?? []) {
    if (m.comp_level !== 'qm' || !hasResult(m)) continue;
    for (const side of ['red', 'blue'] as const) {
      for (const k of m.alliances?.[side]?.team_keys ?? []) played.set(k, (played.get(k) ?? 0) + 1);
    }
  }

  const records = qualRecords(data.rankings, data.matches);

  const ranks = new Map<string, number>();
  for (const row of data.rankings?.rankings ?? []) {
    if (row.matches_played > 0 && typeof row.rank === 'number' && row.rank > 0) ranks.set(row.team_key, row.rank);
  }

  const finals = finalsResult(data.alliances, data.matches);
  const finish = new Map<string, BestFinish>();
  (data.alliances ?? []).forEach((a, index) => {
    allianceMembers(a).forEach((teamKey, position) => {
      let f: BestFinish = position === 0 ? 'captain' : 'picked';
      if (index === finals.winner) f = 'winner';
      else if (index === finals.finalist) f = 'finalist';
      finish.set(teamKey, betterFinish(finish.get(teamKey) ?? null, f) ?? f);
    });
  });

  const excluded = new Set(DEFAULT_SCORING.awards.excludedTypes);
  const awards = new Map<string, TeamStatsAward[]>();
  for (const award of data.awards ?? []) {
    if (excluded.has(award.award_type)) continue;
    for (const r of award.recipient_list ?? []) {
      if (!r.team_key) continue;
      const list = awards.get(r.team_key) ?? [];
      list.push({ type: award.award_type, name: award.name, eventKey: event.key });
      awards.set(r.team_key, list);
    }
  }

  const oprs = data.oprs?.oprs ?? {};
  return [...played.entries()]
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([teamKey, playedQuals]) => {
      const rec = records.get(teamKey) ?? { wins: 0, losses: 0, ties: 0 };
      const opr = oprs[teamKey];
      return {
        teamKey,
        eventKey: event.key,
        name: event.name,
        endDate: event.end_date,
        playedQuals,
        wins: rec.wins,
        losses: rec.losses,
        ties: rec.ties,
        rank: ranks.get(teamKey) ?? null,
        finish: finish.get(teamKey) ?? null,
        points: scores.teams.get(teamKey)?.total ?? 0,
        opr: typeof opr === 'number' && Number.isFinite(opr) ? opr : null,
        awards: awards.get(teamKey) ?? [],
      };
    });
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/stats`
Expected: all PASS. If `frc7414` comes back as `winner`/`finalist`, re-read the fixture facts in CLAUDE.md (winner Alliance 3, finalist Alliance 4 — zero-based indexes 2 and 3 from `finalsResult`).

- [ ] **Step 7: Commit**

```bash
git add lib/stats/projection.ts lib/stats/summarize.ts tests/stats/projection.test.ts tests/stats/summarize.test.ts
git commit -m "feat(sp3): projection math and per-event team summaries"
```

---

### Task 10: Roll summaries into one `team_stats` row

**Files:**
- Modify: `lib/stats/summarize.ts` (add `aggregateTeamSeason`)
- Test: `tests/stats/aggregate.test.ts`

**Interfaces:**
- Consumes: `TeamEventSummary`, `betterFinish` (Task 9), `TeamStatsRow` (Task 1).
- Produces:
  ```ts
  export function aggregateTeamSeason(teamKey: string, season: number, summaries: TeamEventSummary[], updatedAt: string): TeamStatsRow;
  ```
  Ignores summaries for other teams and duplicate event keys (the cron may hand it the same event twice).

- [ ] **Step 1: Write the failing test**

Create `tests/stats/aggregate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { aggregateTeamSeason, type TeamEventSummary } from '@/lib/stats/summarize';

const s = (eventKey: string, endDate: string, extra: Partial<TeamEventSummary> = {}): TeamEventSummary => ({
  teamKey: 'frc5181',
  eventKey,
  name: `Event ${eventKey}`,
  endDate,
  playedQuals: 10,
  wins: 6,
  losses: 4,
  ties: 0,
  rank: 8,
  finish: 'picked',
  points: 30,
  opr: 25.04,
  awards: [],
  ...extra,
});

const T = '2026-10-24T12:00:00.000Z';

describe('aggregateTeamSeason', () => {
  it('sums points and records, and lists events oldest first', () => {
    const row = aggregateTeamSeason('frc5181', 2026, [
      s('2026pahat', '2026-03-22', { points: 50, wins: 8, losses: 2, finish: 'finalist' }),
      s('2026paca', '2026-03-08'),
    ], T);
    expect(row).toMatchObject({
      teamKey: 'frc5181',
      season: 2026,
      eventsPlayed: 2,
      totalPoints: 80,
      qualWins: 14,
      qualLosses: 6,
      qualTies: 0,
      bestFinish: 'finalist',
      updatedAt: T,
    });
    expect(row.events.map((e) => e.eventKey)).toEqual(['2026paca', '2026pahat']);
    expect(row.events[1]).toEqual({ eventKey: '2026pahat', name: 'Event 2026pahat', endDate: '2026-03-22', rank: 8, finish: 'finalist', points: 50 });
  });

  it('takes OPR and rank from the latest event that has them, rounded to one decimal', () => {
    const row = aggregateTeamSeason('frc5181', 2026, [
      s('2026paca', '2026-03-08', { opr: 31.26, rank: 4 }),
      s('2026mrcmp', '2026-04-05', { opr: null, rank: null }), // no data posted
    ], T);
    expect(row.latestEventKey).toBe('2026paca');
    expect(row.latestOpr).toBe(31.3);
    expect(row.latestRank).toBe(4);
  });

  it('collects awards across events', () => {
    const row = aggregateTeamSeason('frc5181', 2026, [
      s('2026paca', '2026-03-08', { awards: [{ type: 0, name: 'Impact', eventKey: '2026paca' }] }),
      s('2026pahat', '2026-03-22', { awards: [{ type: 9, name: 'Engineering Inspiration', eventKey: '2026pahat' }] }),
    ], T);
    expect(row.awards.map((a) => a.type)).toEqual([0, 9]);
  });

  it('ignores other teams and duplicate events', () => {
    const row = aggregateTeamSeason('frc5181', 2026, [
      s('2026paca', '2026-03-08'),
      s('2026paca', '2026-03-08'),
      s('2026paca', '2026-03-08', { teamKey: 'frc341', points: 999 }),
    ], T);
    expect(row.eventsPlayed).toBe(1);
    expect(row.totalPoints).toBe(30);
  });

  it('has nulls, not zeros, when nothing is known', () => {
    const row = aggregateTeamSeason('frc5181', 2026, [s('2026paca', '2026-03-08', { opr: null, rank: null, finish: null })], T);
    expect(row.bestFinish).toBeNull();
    expect(row.latestEventKey).toBeNull();
    expect(row.latestOpr).toBeNull();
    expect(row.latestRank).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/stats/aggregate.test.ts`
Expected: FAIL with `aggregateTeamSeason is not a function` (or not exported).

- [ ] **Step 3: Implement**

Append to `lib/stats/summarize.ts` (and add `TeamStatsRow` to its type import from `@/lib/db/types`):

```ts
/** One team's season row (spec §6.1) from its per-event summaries. */
export function aggregateTeamSeason(
  teamKey: string,
  season: number,
  summaries: TeamEventSummary[],
  updatedAt: string,
): TeamStatsRow {
  const seen = new Set<string>();
  const mine = summaries
    .filter((s) => s.teamKey === teamKey && !seen.has(s.eventKey) && (seen.add(s.eventKey), true))
    .sort((a, b) => a.endDate.localeCompare(b.endDate) || a.eventKey.localeCompare(b.eventKey));

  const latest = [...mine].reverse().find((s) => s.opr !== null || s.rank !== null) ?? null;
  return {
    teamKey,
    season,
    eventsPlayed: mine.length,
    totalPoints: mine.reduce((sum, s) => sum + s.points, 0),
    qualWins: mine.reduce((sum, s) => sum + s.wins, 0),
    qualLosses: mine.reduce((sum, s) => sum + s.losses, 0),
    qualTies: mine.reduce((sum, s) => sum + s.ties, 0),
    bestFinish: mine.reduce<BestFinish | null>((best, s) => betterFinish(best, s.finish), null),
    awards: mine.flatMap((s) => s.awards),
    events: mine.map((s) => ({
      eventKey: s.eventKey,
      name: s.name,
      endDate: s.endDate,
      rank: s.rank,
      finish: s.finish,
      points: s.points,
    })),
    latestEventKey: latest?.eventKey ?? null,
    latestOpr: latest?.opr === null || latest?.opr === undefined ? null : Math.round(latest.opr * 10) / 10,
    latestRank: latest?.rank ?? null,
    updatedAt,
  };
}
```

- [ ] **Step 4: Run the tests and commit**

Run: `npx vitest run tests/stats && npm run typecheck`
Expected: all PASS.

```bash
git add lib/stats/summarize.ts tests/stats/aggregate.test.ts
git commit -m "feat(sp3): aggregate event summaries into a team_stats row"
```

---

### Task 11: Season builder, throttle, and the build scripts

**Files:**
- Create: `lib/tba/throttle.ts`, `lib/stats/build.ts`, `scripts/build-team-stats.ts`, `scripts/show-team-stats.ts`
- Test: `tests/tba/throttle.test.ts`, `tests/stats/build.test.ts`

**Interfaces:**
- Consumes: `getEventScores` (Task 6), `loadEventData(…, deps)`, `cleanEventData` (Task 5), `summarizeEvent`, `aggregateTeamSeason` (Tasks 9–10), `upsertTeamStats`, `getTeamStats` (Task 4), `projection` (Task 9), v1 `getTba`, `localDate`, `addDays`, `MINUTE_MS`.
- Produces:
  ```ts
  // lib/tba/throttle.ts
  export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };
  export function throttleFetch(fetchImpl: typeof fetch, perSecond: number, clock?: Clock): typeof fetch;
  // lib/stats/build.ts
  export const NEVER_REFETCH_MS: number;                               // Number.POSITIVE_INFINITY
  export type StatsDeps = { repo: Repo; now: Date; tba?: Partial<TbaDeps>; clock?: () => number };
  export function statsWindowMs(event: { key: string; end_date: string; timezone?: string | null }, now: Date): number;
  export function countsForStats(event: TbaEvent): boolean;          // event_type !== 100
  export async function listSeasonEvents(season: number, deps: StatsDeps): Promise<TbaEvent[]>;
  export async function loadEventSummaries(event: TbaEvent, deps: StatsDeps): Promise<TeamEventSummary[]>;
  export async function buildSeasonStats(season: number, deps: StatsDeps, opts?: { log?: (line: string) => void }): Promise<{ events: number; teams: number; skipped: string[] }>;
  ```

- [ ] **Step 1: Write the failing throttle test**

Create `tests/tba/throttle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { throttleFetch } from '@/lib/tba/throttle';

describe('throttleFetch', () => {
  it('spaces requests 1/perSecond apart, even when fired all at once', async () => {
    let t = 0;
    const sleeps: number[] = [];
    const clock = {
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    };
    let calls = 0;
    const inner = (async () => {
      calls += 1;
      return new Response('[]');
    }) as typeof fetch;

    const f = throttleFetch(inner, 5, clock);
    await Promise.all([f('a'), f('b'), f('c')]);

    expect(calls).toBe(3);
    expect(sleeps).toEqual([200, 400]);
  });

  it('does not wait when requests are already far apart', async () => {
    let t = 0;
    const sleeps: number[] = [];
    const f = throttleFetch((async () => new Response('[]')) as typeof fetch, 5, {
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await f('a');
    t = 1_000;
    await f('b');
    expect(sleeps).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, implement, run again**

Run: `npx vitest run tests/tba/throttle.test.ts` → FAIL (`Failed to resolve import`).

Create `lib/tba/throttle.ts`:

```ts
export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Wraps fetch so calls start at most `perSecond` times a second (spec §6.2: ~5 TBA requests/s
 * for the stats build). Calls fired together are queued, each one slot after the last.
 */
export function throttleFetch(fetchImpl: typeof fetch, perSecond: number, clock: Clock = realClock): typeof fetch {
  const gapMs = 1000 / perSecond;
  let nextAt = 0;
  return (async (...args: Parameters<typeof fetch>) => {
    const now = clock.now();
    const at = Math.max(now, nextAt);
    nextAt = at + gapMs;
    if (at > now) await clock.sleep(at - now);
    return fetchImpl(...args);
  }) as typeof fetch;
}
```

Run: `npx vitest run tests/tba/throttle.test.ts` → 2 PASS.

- [ ] **Step 3: Write the failing builder test**

Create `tests/stats/build.test.ts`. A fake TBA serves a 2025 season with three events: Ramp Riot (the real fixture), an Einstein-style finals-only event, and a preseason event that must never be requested.

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  getRepo: () => {
    throw new Error('the builder must use deps.repo');
  },
}));

import { buildSeasonStats, NEVER_REFETCH_MS, statsWindowMs } from '@/lib/stats/build';
import type { EventData, TbaEvent } from '@/lib/tba/types';
import { alliance, emptyEvent, match } from '../helpers/builders';
import { loadFixture, loadFixtureEvent } from '../helpers/fixture';
import { createMemoryRepo } from '../helpers/memoryRepo';

const NOW = new Date('2026-10-01T16:00:00.000Z');
const parrEvent = loadFixtureEvent('2025parr');
const EVENTS: TbaEvent[] = [
  { ...parrEvent, event_type: 99 },
  { key: '2025cmptx', name: 'Einstein', start_date: '2025-04-19', end_date: '2025-04-19', timezone: 'America/Chicago', event_type: 4 },
  { key: '2025week0', name: 'Week Zero', start_date: '2025-02-15', end_date: '2025-02-15', timezone: 'America/New_York', event_type: 100 },
];
const DATA: Record<string, EventData> = {
  '2025parr': loadFixture('2025parr'),
  '2025cmptx': {
    ...emptyEvent(),
    alliances: [alliance(['frc1', 'frc2', 'frc3']), alliance(['frc4', 'frc5', 'frc6'])],
    matches: [match({ level: 'f', num: 1, red: ['frc1', 'frc2', 'frc3'], blue: ['frc4', 'frc5', 'frc6'], redScore: 9, blueScore: 1 })],
  },
};
const SUFFIX: Record<string, keyof EventData> = {
  'teams/simple': 'teams', 'matches/simple': 'matches', rankings: 'rankings',
  alliances: 'alliances', awards: 'awards', oprs: 'oprs',
};

function fakeTba() {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = String(url).replace('https://www.thebluealliance.com/api/v3', '');
    calls.push(u);
    if (u === '/events/2025/simple') return Response.json(EVENTS);
    const m = /^\/event\/([^/]+)\/(.+)$/.exec(u);
    const body = m ? (DATA[m[1]]?.[SUFFIX[m[2]]] ?? null) : null;
    return new Response(JSON.stringify(body), { status: 200, headers: { etag: '"x"' } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('statsWindowMs', () => {
  it('never refetches past seasons, uses 24 h for finished current-season events, 10 min for recent ones', () => {
    expect(statsWindowMs({ key: '2025parr', end_date: '2025-10-18' }, NOW)).toBe(NEVER_REFETCH_MS);
    expect(statsWindowMs({ key: '2026paca', end_date: '2026-03-08' }, NOW)).toBe(24 * 60 * 60_000);
    expect(statsWindowMs({ key: '2026parr', end_date: '2026-09-28' }, NOW)).toBe(10 * 60_000);
  });
});

describe('buildSeasonStats', () => {
  it('writes one row per team that played quals, skipping preseason and Einstein', async () => {
    const repo = createMemoryRepo();
    const tba = fakeTba();
    const log: string[] = [];

    const result = await buildSeasonStats(2025, { repo, now: NOW, tba: { fetchImpl: tba.fetchImpl, apiKey: 'k' } }, { log: (l) => log.push(l) });

    expect(tba.calls.some((c) => c.includes('2025week0'))).toBe(false);
    expect(result.events).toBe(2);
    expect(result.skipped).toEqual(['2025cmptx']);
    expect(result.teams).toBeGreaterThan(30);
    expect(log.length).toBeGreaterThanOrEqual(2);

    const [row] = await repo.getTeamStats(['frc2607'], [2025], { withHistory: true });
    expect(row).toMatchObject({ eventsPlayed: 1, bestFinish: 'winner', latestEventKey: '2025parr', latestOpr: 89.5, latestRank: 3 });
    expect(row.events[0].eventKey).toBe('2025parr');
    expect(await repo.getTeamStats(['frc1'], [2025])).toEqual([]); // Einstein-only team: no row
  });

  it('is resumable: a second run of a past season makes no TBA requests', async () => {
    const repo = createMemoryRepo();
    const tba = fakeTba();
    const deps = { repo, now: NOW, tba: { fetchImpl: tba.fetchImpl, apiKey: 'k' } };
    await buildSeasonStats(2025, deps);
    const first = tba.calls.length;

    await buildSeasonStats(2025, deps);
    expect(tba.calls.length).toBe(first);
  });
});
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `npx vitest run tests/stats/build.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/stats/build"`.

- [ ] **Step 5: Implement the builder**

Create `lib/stats/build.ts`:

```ts
import type { Repo } from '@/lib/db/repo';
import { addDays, localDate, MINUTE_MS } from '@/lib/rounds/status';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { getEventScores } from '@/lib/scores/eventScores';
import { aggregateTeamSeason, summarizeEvent, type TeamEventSummary } from '@/lib/stats/summarize';
import { cleanEventData } from '@/lib/tba/clean';
import { getTba, type TbaDeps } from '@/lib/tba/client';
import { loadEventData } from '@/lib/tba/event';
import type { TbaEvent } from '@/lib/tba/types';

/** Past seasons are final: once a path is cached it is never fetched again (spec §6.2). */
export const NEVER_REFETCH_MS = Number.POSITIVE_INFINITY;
const DAY_MS = 24 * 60 * MINUTE_MS;
const PRESEASON = 100;

export type StatsDeps = {
  repo: Repo;
  now: Date;
  /** Passed to getTba: the build script throttles fetch here; tests fake it. */
  tba?: Partial<TbaDeps>;
  /** Wall clock for time budgets (ms). Defaults to Date.now. */
  clock?: () => number;
};

const tbaDeps = (deps: StatsDeps): Partial<TbaDeps> => ({ store: deps.repo, ...deps.tba });

export function statsWindowMs(event: { key: string; end_date: string; timezone?: string | null }, now: Date): number {
  const today = localDate(now, event.timezone ?? null);
  if (Number(event.key.slice(0, 4)) < Number(today.slice(0, 4))) return NEVER_REFETCH_MS;
  if (event.end_date < addDays(today, -8)) return DAY_MS;
  return 10 * MINUTE_MS;
}

/** Spec §6.1: every event except preseason. Offseason counts when it has played quals (summarizeEvent checks). */
export function countsForStats(event: TbaEvent): boolean {
  return event.event_type !== PRESEASON;
}

const isEvent = (e: unknown): e is TbaEvent =>
  typeof e === 'object' && e !== null && typeof (e as TbaEvent).key === 'string' &&
  typeof (e as TbaEvent).end_date === 'string' && typeof (e as TbaEvent).start_date === 'string';

export async function listSeasonEvents(season: number, deps: StatsDeps): Promise<TbaEvent[]> {
  const thisYear = Number(localDate(deps.now, 'America/New_York').slice(0, 4));
  const res = await getTba<unknown[]>(
    `/events/${season}/simple`,
    { windowMs: season < thisYear ? NEVER_REFETCH_MS : 10 * MINUTE_MS },
    tbaDeps(deps),
  );
  const events = Array.isArray(res.data) ? res.data.filter(isEvent) : [];
  return events
    .filter(countsForStats)
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.key.localeCompare(b.key));
}

/** Scores the event with DEFAULT_SCORING through event_scores, then summarizes it per team. */
export async function loadEventSummaries(event: TbaEvent, deps: StatsDeps): Promise<TeamEventSummary[]> {
  const windowMs = statsWindowMs(event, deps.now);
  const scored = await getEventScores(event.key, DEFAULT_SCORING, windowMs, {
    now: deps.now,
    repo: deps.repo,
    tba: deps.tba,
  });
  // getEventScores just refreshed these paths, so this reads tba_cache only.
  const loaded = await loadEventData(event.key, { windowMs }, tbaDeps(deps));
  return summarizeEvent(event, cleanEventData(loaded.data), scored.scores);
}

/**
 * Builds every team_stats row for one season (scripts/build-team-stats.ts). Resumable: each TBA
 * response is saved to tba_cache as it arrives, and past seasons are never refetched, so a rerun
 * after an interruption reads the saved rows at database speed.
 */
export async function buildSeasonStats(
  season: number,
  deps: StatsDeps,
  opts: { log?: (line: string) => void } = {},
): Promise<{ events: number; teams: number; skipped: string[] }> {
  const log = opts.log ?? (() => {});
  const events = await listSeasonEvents(season, deps);
  const all: TeamEventSummary[] = [];
  const skipped: string[] = [];

  for (const [i, event] of events.entries()) {
    const summaries = await loadEventSummaries(event, deps);
    if (summaries.length === 0) skipped.push(event.key);
    all.push(...summaries);
    log(`[${i + 1}/${events.length}] ${event.key}  ${summaries.length} teams`);
  }

  const byTeam = new Map<string, TeamEventSummary[]>();
  for (const s of all) byTeam.set(s.teamKey, [...(byTeam.get(s.teamKey) ?? []), s]);
  const updatedAt = deps.now.toISOString();
  const rows = [...byTeam].map(([teamKey, list]) => aggregateTeamSeason(teamKey, season, list, updatedAt));
  await deps.repo.upsertTeamStats(rows);
  return { events: events.length, teams: rows.length, skipped };
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/stats tests/tba`
Expected: all PASS.

- [ ] **Step 7: Write the two scripts**

Create `scripts/build-team-stats.ts`:

```ts
// Builds team_stats for one season from TBA (spec §6.2), ~5 requests/s.
// Safe to stop and rerun: finished work is read back from tba_cache instead of TBA.
// Usage: npx tsx --env-file=.env.local scripts/build-team-stats.ts 2025
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';
import { buildSeasonStats } from '@/lib/stats/build';
import { throttleFetch } from '@/lib/tba/throttle';

async function main() {
  const season = Number(process.argv[2]);
  if (!Number.isInteger(season) || season < 1992 || season > 2100) {
    throw new Error('Usage: build-team-stats.ts <season>   e.g. 2025');
  }
  if (!process.env.TBA_API_KEY) throw new Error('TBA_API_KEY is not set. Put it in .env.local.');

  const repo = createSupabaseRepo(createSupabaseClient());
  const started = Date.now();
  const result = await buildSeasonStats(
    season,
    { repo, now: new Date(), tba: { fetchImpl: throttleFetch(fetch, 5) } },
    { log: (line) => console.log(line) },
  );
  const secs = Math.round((Date.now() - started) / 1000);
  console.log(
    `Done: ${season} — ${result.events} events, ${result.teams} team rows, ` +
      `${result.skipped.length} events with no played quals (${secs} s).`,
  );
  if (result.events === 0) console.log(`TBA returned no events for ${season}. Is the season published yet?`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

Create `scripts/show-team-stats.ts`:

```ts
// Prints a team's team_stats rows and the projection a draft in <season> would show.
// Usage: npx tsx --env-file=.env.local scripts/show-team-stats.ts 5181 2026
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';
import { projection } from '@/lib/stats/projection';

async function main() {
  const team = Number(process.argv[2]);
  const season = Number(process.argv[3]);
  if (!Number.isInteger(team) || team < 1 || !Number.isInteger(season)) {
    throw new Error('Usage: show-team-stats.ts <teamNumber> <season>   e.g. 5181 2026');
  }
  const repo = createSupabaseRepo(createSupabaseClient());
  const rows = await repo.getTeamStats([`frc${team}`], [season, season - 1], { withHistory: true });
  const cur = rows.find((r) => r.season === season) ?? null;
  const prev = rows.find((r) => r.season === season - 1) ?? null;
  for (const r of [cur, prev]) {
    if (!r) continue;
    console.log(`\n${r.teamKey} ${r.season}: ${r.eventsPlayed} events, ${r.totalPoints} pts, ` +
      `${r.qualWins}-${r.qualLosses}-${r.qualTies}, best ${r.bestFinish ?? '—'}, ` +
      `OPR ${r.latestOpr ?? '—'} / rank ${r.latestRank ?? '—'} at ${r.latestEventKey ?? '—'}`);
    for (const e of r.events) console.log(`  ${e.endDate}  ${e.eventKey.padEnd(12)} rank ${e.rank ?? '—'}  ${e.finish ?? ''}  +${e.points}`);
    for (const a of r.awards) console.log(`  award: ${a.name} (${a.eventKey})`);
  }
  const proj = projection(
    cur && { points: cur.totalPoints, events: cur.eventsPlayed },
    prev && { points: prev.totalPoints, events: prev.eventsPlayed },
  );
  console.log(`\nProj for a ${season} draft: ${proj ?? 'New'}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck
git add lib/tba/throttle.ts lib/stats/build.ts scripts/build-team-stats.ts scripts/show-team-stats.ts tests/tba/throttle.test.ts tests/stats/build.test.ts
git commit -m "feat(sp3): season stats builder, throttled fetch, build/show scripts"
```

---

### Task 12: Current-season refresh (the cron's job logic)

**Files:**
- Modify: `lib/stats/build.ts` (add `teamSeasonEvents`, `refreshRecentTeams`)
- Test: `tests/stats/refresh.test.ts`

**Interfaces:**
- Consumes: Task 11's helpers; `getTeamStats`, `upsertTeamStats` (Task 4).
- Produces:
  ```ts
  export async function teamSeasonEvents(teamKey: string, season: number, deps: StatsDeps): Promise<TbaEvent[]>;
  export async function refreshRecentTeams(season: number, deps: StatsDeps, deadline: number): Promise<{ events: number; teams: number; remaining: number; complete: boolean }>;
  ```
  `deadline` is an epoch-ms time from `deps.clock` (default `Date.now`). Recent events = `event_type ≠ 100`, `start_date ≤ today`, `end_date ≥ today − 8` (Eastern date). Teams are refreshed **least-recently-updated first**.

- [ ] **Step 1: Write the failing test**

Create `tests/stats/refresh.test.ts`. Time is fake: each `upsertTeamStats` "takes" 20 s, and the budget is 50 s, so a run gets through 3 teams — Review Focus 4.

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  getRepo: () => {
    throw new Error('use deps.repo');
  },
}));

import type { Repo } from '@/lib/db/repo';
import { refreshRecentTeams } from '@/lib/stats/build';
import type { EventData, TbaEvent } from '@/lib/tba/types';
import { emptyEvent, match } from '../helpers/builders';
import { createMemoryRepo } from '../helpers/memoryRepo';

const ev = (key: string, start: string, end: string): TbaEvent => ({
  key, name: key, start_date: start, end_date: end, timezone: 'America/New_York', event_type: 1,
});
// "Today" is 2026-03-20 in Eastern time.
const EVENTS = [
  ev('2026old', '2026-03-01', '2026-03-03'), // ended more than 8 days ago: skipped
  ev('2026aaa', '2026-03-14', '2026-03-16'), // recent
  ev('2026bbb', '2026-03-19', '2026-03-21'), // happening now
  ev('2026zzz', '2026-03-27', '2026-03-29'), // future: skipped
];
const played = (red: string[], blue: string[]): EventData => ({
  ...emptyEvent(),
  matches: [match({ num: 1, red, blue, redScore: 10, blueScore: 5 })],
});
const DATA: Record<string, EventData> = {
  '2026old': played(['frc91', 'frc92', 'frc93'], ['frc94', 'frc95', 'frc96']),
  '2026aaa': played(['frc1', 'frc2', 'frc3'], ['frc4', 'frc5', 'frc6']),
  '2026bbb': played(['frc11', 'frc12', 'frc13'], ['frc14', 'frc15', 'frc16']),
};
const SUFFIX: Record<string, keyof EventData> = {
  'teams/simple': 'teams', 'matches/simple': 'matches', rankings: 'rankings',
  alliances: 'alliances', awards: 'awards', oprs: 'oprs',
};
const eventOf = (team: number) => (team < 10 ? EVENTS[1] : team < 90 ? EVENTS[2] : EVENTS[0]);

function setup() {
  let t = 0;
  const inner = createMemoryRepo();
  const repo: Repo = {
    ...inner,
    upsertTeamStats: async (rows) => {
      t += 20_000; // each team's write "takes" 20 s of the budget
      return inner.upsertTeamStats(rows);
    },
  };
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = String(url).replace('https://www.thebluealliance.com/api/v3', '');
    calls.push(u);
    if (u === '/events/2026/simple') return Response.json(EVENTS);
    const team = /^\/team\/frc(\d+)\/events\/2026\/simple$/.exec(u);
    if (team) return Response.json([eventOf(Number(team[1]))]);
    const m = /^\/event\/([^/]+)\/(.+)$/.exec(u);
    return Response.json(m ? (DATA[m[1]]?.[SUFFIX[m[2]]] ?? null) : null);
  }) as typeof fetch;
  const deps = (now: string) => ({
    repo,
    now: new Date(now),
    clock: () => t,
    tba: { fetchImpl, apiKey: 'k', now: () => new Date(now) },
  });
  return { repo, calls, deps, resetClock: () => (t = 0) };
}

async function teamsWithRows(repo: Repo): Promise<string[]> {
  const keys = [1, 2, 3, 4, 5, 6, 11, 12, 13, 14, 15, 16, 91].map((n) => `frc${n}`);
  return (await repo.getTeamStats(keys, [2026])).map((r) => r.teamKey).sort();
}

describe('refreshRecentTeams', () => {
  it('only refreshes teams at events inside [today − 8, today]', async () => {
    const { repo, deps } = setup();
    const res = await refreshRecentTeams(2026, deps('2026-03-20T15:00:00.000Z'), 1_000_000); // plenty of budget
    expect(res).toMatchObject({ events: 2, teams: 12, remaining: 0, complete: true });
    const rows = await teamsWithRows(repo);
    expect(rows).toHaveLength(12);
    expect(rows).not.toContain('frc91');
  });

  // Review Focus 4.
  it('stops at the budget, reports it, and starts the next run with the teams it missed', async () => {
    const { repo, deps, resetClock } = setup();

    const first = await refreshRecentTeams(2026, deps('2026-03-20T15:00:00.000Z'), 50_000);
    expect(first).toMatchObject({ events: 2, teams: 3, remaining: 9, complete: false });
    const afterFirst = await teamsWithRows(repo);
    expect(afterFirst).toHaveLength(3);

    resetClock();
    const second = await refreshRecentTeams(2026, deps('2026-03-21T15:00:00.000Z'), 50_000);
    expect(second.teams).toBe(3);
    const afterSecond = await teamsWithRows(repo);
    expect(afterSecond).toHaveLength(6); // three NEW teams, not the same three again
    for (const k of afterFirst) expect(afterSecond).toContain(k);
  });

  it('does nothing (and does not throw) when TBA has no event list', async () => {
    const repo = createMemoryRepo();
    const fetchImpl = (async () => { throw new Error('offline'); }) as typeof fetch;
    const res = await refreshRecentTeams(2026, { repo, now: new Date('2026-03-20T15:00:00.000Z'), tba: { fetchImpl, apiKey: 'k' } }, Date.now() + 50_000);
    expect(res).toEqual({ events: 0, teams: 0, remaining: 0, complete: true });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/stats/refresh.test.ts`
Expected: FAIL with `refreshRecentTeams is not a function` (not exported).

- [ ] **Step 3: Implement**

Append to `lib/stats/build.ts`:

```ts
export async function teamSeasonEvents(teamKey: string, season: number, deps: StatsDeps): Promise<TbaEvent[]> {
  const res = await getTba<unknown[]>(`/team/${teamKey}/events/${season}/simple`, { windowMs: 10 * MINUTE_MS }, tbaDeps(deps));
  return (Array.isArray(res.data) ? res.data.filter(isEvent) : []).filter(countsForStats);
}

/**
 * The daily cron's team_stats job (spec §6.2): re-score current-season events with any day in
 * [today − 8, today], then rebuild the season row of every team at them. Stops at `deadline`;
 * teams are taken least-recently-updated first, so the next run continues where this one stopped.
 */
export async function refreshRecentTeams(
  season: number,
  deps: StatsDeps,
  deadline: number,
): Promise<{ events: number; teams: number; remaining: number; complete: boolean }> {
  const clock = deps.clock ?? Date.now;
  const today = localDate(deps.now, 'America/New_York');
  const recent = (await listSeasonEvents(season, deps)).filter(
    (e) => e.start_date <= today && e.end_date >= addDays(today, -8),
  );

  // One load per event per run, shared by every team that played there.
  const memo = new Map<string, Promise<TeamEventSummary[]>>();
  const summariesFor = (event: TbaEvent) => {
    let p = memo.get(event.key);
    if (!p) {
      p = loadEventSummaries(event, deps);
      memo.set(event.key, p);
    }
    return p;
  };

  const teamSet = new Set<string>();
  for (const event of recent) {
    if (clock() >= deadline) return { events: recent.length, teams: 0, remaining: teamSet.size, complete: false };
    for (const s of await summariesFor(event)) teamSet.add(s.teamKey);
  }

  const existing = await deps.repo.getTeamStats([...teamSet], [season]);
  const updatedAt = new Map(existing.map((r) => [r.teamKey, r.updatedAt]));
  // Never-updated teams sort first ('' < any ISO time), then the stalest.
  const order = [...teamSet].sort(
    (a, b) => (updatedAt.get(a) ?? '').localeCompare(updatedAt.get(b) ?? '') || a.localeCompare(b),
  );

  let done = 0;
  for (const teamKey of order) {
    if (clock() >= deadline) break;
    const summaries: TeamEventSummary[] = [];
    for (const event of await teamSeasonEvents(teamKey, season, deps)) {
      summaries.push(...(await summariesFor(event)).filter((s) => s.teamKey === teamKey));
    }
    if (summaries.length > 0) {
      await deps.repo.upsertTeamStats([aggregateTeamSeason(teamKey, season, summaries, deps.now.toISOString())]);
    }
    done += 1;
  }
  return { events: recent.length, teams: done, remaining: order.length - done, complete: done === order.length };
}
```

- [ ] **Step 4: Run the tests and commit**

Run: `npx vitest run tests/stats && npm run typecheck`
Expected: all PASS.

```bash
git add lib/stats/build.ts tests/stats/refresh.test.ts
git commit -m "feat(sp3): current-season team_stats refresh with a time budget"
```

---

### Task 13: Daily cron route

**Files:**
- Create: `lib/cron/auth.ts`, `lib/cron/jobs.ts`, `app/api/cron/daily/route.ts`, `vercel.json`
- Test: `tests/cron/cron.test.ts`

**Interfaces:**
- Consumes: `refreshRecentTeams` (Task 12), v1 `handle`, `HttpError`, `json`, `localDate`, `getRepo`.
- Produces (contract names — SP2 appends its follow-sync and season-date jobs to `DAILY_JOBS`):
  ```ts
  // lib/cron/auth.ts
  export function cronAuthorized(authorization: string | null, secret: string | undefined): boolean;
  // lib/cron/jobs.ts
  export type DailyJob = { name: string; run(now: Date, deadline: number): Promise<void> };
  export type JobResult = { name: string; ok: boolean; skipped: boolean; error?: string; ms: number };
  export const DAILY_JOBS: DailyJob[];                     // [team-stats]
  export async function runDailyJobs(jobs: DailyJob[], now: Date, deadline: number, clock?: () => number): Promise<JobResult[]>;
  // app/api/cron/daily/route.ts
  export const dynamic = 'force-dynamic'; export const maxDuration = 60; export async function GET(req: Request): Promise<Response>;
  ```
  Jobs run in array order; each gets the same `deadline` (start + 50 s) and must stop itself when `Date.now() >= deadline`. A job that throws is logged and reported; later jobs still run. A job that would start after the deadline is reported as `skipped`.

- [ ] **Step 1: Write the failing test**

Create `tests/cron/cron.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/cron/cron.test.ts`
Expected: FAIL with `Failed to resolve import "@/app/api/cron/daily/route"`.

- [ ] **Step 3: Implement the auth check**

Create `lib/cron/auth.ts`:

```ts
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Vercel cron sends `Authorization: Bearer $CRON_SECRET` (spec §8.1). Compared in constant time by
 * hashing both sides to the same length first. With no secret configured, nothing is authorized.
 */
export function cronAuthorized(authorization: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(authorization ?? ''), digest(`Bearer ${secret}`));
}
```

- [ ] **Step 4: Implement the job runner and the team-stats job**

Create `lib/cron/jobs.ts`:

```ts
import { getRepo } from '@/lib/db';
import { localDate } from '@/lib/rounds/status';
import { refreshRecentTeams } from '@/lib/stats/build';

/** One piece of daily work. It must stop on its own once Date.now() >= deadline. */
export type DailyJob = { name: string; run(now: Date, deadline: number): Promise<void> };

export type JobResult = { name: string; ok: boolean; skipped: boolean; error?: string; ms: number };

/**
 * Everything /api/cron/daily does, in order. SP3 adds team-stats; SP2 appends follow-a-team sync
 * and season-round date refresh. Order matters only for who gets the time budget first.
 */
export const DAILY_JOBS: DailyJob[] = [
  {
    name: 'team-stats',
    async run(now, deadline) {
      const season = Number(localDate(now, 'America/New_York').slice(0, 4));
      const res = await refreshRecentTeams(season, { repo: getRepo(), now }, deadline);
      console.log(
        `team-stats ${season}: ${res.teams} teams from ${res.events} recent events, ${res.remaining} left` +
          (res.complete ? '' : ' (time budget reached; the next run continues)'),
      );
    },
  },
];

export async function runDailyJobs(
  jobs: DailyJob[],
  now: Date,
  deadline: number,
  clock: () => number = Date.now,
): Promise<JobResult[]> {
  const results: JobResult[] = [];
  for (const job of jobs) {
    const start = clock();
    if (start >= deadline) {
      results.push({ name: job.name, ok: true, skipped: true, ms: 0 });
      continue;
    }
    try {
      await job.run(now, deadline);
      results.push({ name: job.name, ok: true, skipped: false, ms: clock() - start });
    } catch (err) {
      console.error(`Cron job ${job.name} failed`, err);
      results.push({
        name: job.name,
        ok: false,
        skipped: false,
        error: err instanceof Error ? err.message : String(err),
        ms: clock() - start,
      });
    }
  }
  return results;
}
```

- [ ] **Step 5: Implement the route and the schedule**

Create `app/api/cron/daily/route.ts`:

```ts
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
```

Create `vercel.json` in the repo root:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/cron/daily", "schedule": "0 10 * * *" }]
}
```

(Vercel Hobby runs crons once a day at most and may start them any time within the hour. 10:00 UTC is 6 am Eastern, after the day's last matches have posted.)

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/cron tests/config`
Expected: all PASS. `tests/config/dynamic-exports.test.ts` finds the new route: `dynamic` passes, and because the route's source mentions none of the `TBA_USERS` names, it isn't held to `maxDuration = 30` (it has its own 60 s check above).

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add lib/cron/auth.ts lib/cron/jobs.ts app/api/cron/daily/route.ts vercel.json tests/cron/cron.test.ts
git commit -m "feat(sp3): daily cron route with team-stats job and 50 s budget"
```

---

### Task 14: `teamStatsPoolLookup` — stats in the draft pool and in auto-pick

**Files:**
- Create: `lib/stats/pool.ts`
- Modify: `lib/pool/entries.ts` (SP4's file: default `stats` argument)
- Test: `tests/stats/poolLookup.test.ts`

**Interfaces:**
- Consumes: SP4's `PoolStatsLookup`, `PoolEntry`, `buildPoolEntries`, `noPoolStats` (`lib/pool/entries.ts`); `getTeamStats` (Task 4); `projection` (Task 9).
- Produces (contract name):
  ```ts
  export const teamStatsPoolLookup: PoolStatsLookup;
  // Also, for Task 16:
  export type TeamSheetSeason = { season: number; eventsPlayed: number; totalPoints: number; record: [number, number, number]; bestFinish: BestFinish | null; events: TeamStatsEvent[]; awards: TeamStatsAward[] };
  export type TeamSheetData = { teamKey: string; season: number; proj: number | null; seasons: TeamSheetSeason[] };
  export function teamSheet(teamKey: string, season: number, rows: TeamStatsRow[]): TeamSheetData;
  ```
  Rules (Review Focus 5): `proj` from both seasons (formula §6.1); `record` and `bestFinish` from season `Y`, else `Y−1`; `opr`/`rank` from the latest season row that has a `latestEventKey` (Y first, then Y−1). A team with no row in either season is left out of the map, so the pool shows "New".

- [ ] **Step 1: Write the failing test**

Create `tests/stats/poolLookup.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));

import type { Repo } from '@/lib/db/repo';
import type { TeamStatsRow } from '@/lib/db/types';
import { teamSheet, teamStatsPoolLookup } from '@/lib/stats/pool';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
beforeEach(() => {
  repo = createMemoryRepo();
  h.repo = repo;
});

const row = (teamKey: string, season: number, extra: Partial<TeamStatsRow> = {}): TeamStatsRow => ({
  teamKey,
  season,
  eventsPlayed: 2,
  totalPoints: 80,
  qualWins: 10,
  qualLosses: 4,
  qualTies: 0,
  bestFinish: 'captain',
  awards: [],
  events: [],
  latestEventKey: `${season}pahat`,
  latestOpr: 40.1,
  latestRank: 5,
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...extra,
});

describe('teamStatsPoolLookup', () => {
  it('projects from both seasons and reads the rest from the draft season', async () => {
    await repo.upsertTeamStats([
      row('frc341', 2026, { totalPoints: 80, eventsPlayed: 2, qualWins: 12, bestFinish: 'winner', latestOpr: 55.5, latestRank: 1 }),
      row('frc341', 2025, { totalPoints: 30, eventsPlayed: 1 }),
    ]);
    const stats = await teamStatsPoolLookup(['frc341'], 2026);
    // (2 × 80 + 30) / (2 × 2 + 1) = 38
    expect(stats.get('frc341')).toEqual({ proj: 38, record: [12, 4, 0], bestFinish: 'winner', opr: 55.5, rank: 1 });
  });

  // Review Focus 5.
  it('falls back to last season when the team has no row this season', async () => {
    await repo.upsertTeamStats([row('frc5181', 2025, { totalPoints: 90, eventsPlayed: 3, bestFinish: 'picked', latestOpr: 20, latestRank: 12 })]);
    expect((await teamStatsPoolLookup(['frc5181'], 2026)).get('frc5181')).toEqual({
      proj: 30,
      record: [10, 4, 0],
      bestFinish: 'picked',
      opr: 20,
      rank: 12,
    });
  });

  it('takes OPR/rank from last season when this season has results but no OPR/rank yet', async () => {
    await repo.upsertTeamStats([
      row('frc1', 2026, { latestEventKey: null, latestOpr: null, latestRank: null }),
      row('frc1', 2025, { latestOpr: 33.3, latestRank: 7 }),
    ]);
    const got = (await teamStatsPoolLookup(['frc1'], 2026)).get('frc1')!;
    expect(got.opr).toBe(33.3);
    expect(got.rank).toBe(7);
    expect(got.record).toEqual([10, 4, 0]);
  });

  it('leaves teams with no rows out, so the pool shows "New"', async () => {
    await repo.upsertTeamStats([row('frc341', 2026)]);
    const stats = await teamStatsPoolLookup(['frc341', 'frc9999'], 2026);
    expect(stats.has('frc9999')).toBe(false);
    expect(await teamStatsPoolLookup([], 2026)).toEqual(new Map());
  });

  it('ignores seasons other than Y and Y−1', async () => {
    await repo.upsertTeamStats([row('frc341', 2024)]);
    expect((await teamStatsPoolLookup(['frc341'], 2026)).size).toBe(0);
  });
});

describe('teamSheet', () => {
  it('lists the draft season first, with the projection', () => {
    const data = teamSheet('frc341', 2026, [row('frc341', 2025), row('frc341', 2026)]);
    expect(data.seasons.map((s) => s.season)).toEqual([2026, 2025]);
    expect(data.proj).toBe(40);
    expect(data.seasons[0].record).toEqual([10, 4, 0]);
  });

  it('is empty with proj null for a New team', () => {
    expect(teamSheet('frc9999', 2026, [])).toEqual({ teamKey: 'frc9999', season: 2026, proj: null, seasons: [] });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/stats/poolLookup.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/stats/pool"`.

- [ ] **Step 3: Implement**

Create `lib/stats/pool.ts`:

```ts
import { getRepo } from '@/lib/db';
import type { BestFinish, TeamStatsAward, TeamStatsEvent, TeamStatsRow } from '@/lib/db/types';
import type { PoolStatsLookup } from '@/lib/pool/entries';
import { projection, type SeasonTotals } from '@/lib/stats/projection';

type PoolStats = Awaited<ReturnType<PoolStatsLookup>> extends Map<string, infer V> ? V : never;

const totals = (r: TeamStatsRow | null): SeasonTotals | null =>
  r ? { points: r.totalPoints, events: r.eventsPlayed } : null;

function statsFor(cur: TeamStatsRow | null, prev: TeamStatsRow | null): PoolStats | null {
  const base = cur ?? prev;
  if (!base) return null;
  const latest = cur?.latestEventKey ? cur : prev?.latestEventKey ? prev : null;
  return {
    proj: projection(totals(cur), totals(prev)),
    record: [base.qualWins, base.qualLosses, base.qualTies],
    bestFinish: base.bestFinish,
    opr: latest?.latestOpr ?? null,
    rank: latest?.latestRank ?? null,
  };
}

/** Draft-pool stats from team_stats for season Y and Y−1 (spec §6.1, §6.3). Never computes on the fly. */
export const teamStatsPoolLookup: PoolStatsLookup = async (teamKeys, season) => {
  const out = new Map<string, PoolStats>();
  if (teamKeys.length === 0) return out;
  const rows = await getRepo().getTeamStats(teamKeys, [season, season - 1]);
  const key = (teamKey: string, s: number) => `${teamKey}|${s}`;
  const byKey = new Map(rows.map((r) => [key(r.teamKey, r.season), r]));
  for (const teamKey of teamKeys) {
    const stats = statsFor(byKey.get(key(teamKey, season)) ?? null, byKey.get(key(teamKey, season - 1)) ?? null);
    if (stats) out.set(teamKey, stats);
  }
  return out;
};

export type TeamSheetSeason = {
  season: number;
  eventsPlayed: number;
  totalPoints: number;
  record: [number, number, number];
  bestFinish: BestFinish | null;
  events: TeamStatsEvent[];
  awards: TeamStatsAward[];
};

export type TeamSheetData = { teamKey: string; season: number; proj: number | null; seasons: TeamSheetSeason[] };

/** The tap-a-team sheet (spec §6.3): per-event history for Y and Y−1, newest season first. */
export function teamSheet(teamKey: string, season: number, rows: TeamStatsRow[]): TeamSheetData {
  const mine = rows.filter((r) => r.teamKey === teamKey && (r.season === season || r.season === season - 1));
  const cur = mine.find((r) => r.season === season) ?? null;
  const prev = mine.find((r) => r.season === season - 1) ?? null;
  return {
    teamKey,
    season,
    proj: projection(totals(cur), totals(prev)),
    seasons: mine
      .sort((a, b) => b.season - a.season)
      .map((r) => ({
        season: r.season,
        eventsPlayed: r.eventsPlayed,
        totalPoints: r.totalPoints,
        record: [r.qualWins, r.qualLosses, r.qualTies],
        bestFinish: r.bestFinish,
        events: r.events,
        awards: r.awards,
      })),
  };
}
```

- [ ] **Step 4: Run the lookup tests**

Run: `npx vitest run tests/stats/poolLookup.test.ts`
Expected: 7 PASS.

- [ ] **Step 5: Make it the pool's default**

In `lib/pool/entries.ts` (SP4), import `teamStatsPoolLookup` from `@/lib/stats/pool` and change the default of `buildPoolEntries`'s third parameter from `noPoolStats` to `teamStatsPoolLookup`:

```ts
export async function buildPoolEntries(
  round: RoundRow,
  now: Date,
  stats: PoolStatsLookup = teamStatsPoolLookup,
): Promise<PoolEntry[]> {
```

Keep `noPoolStats` exported (tests use it). Then find every caller that passes `noPoolStats` explicitly and drop that argument:

Run: `grep -rn "noPoolStats" app lib components`
Expected after the edit: only the definition in `lib/pool/entries.ts` (and test files). The pool endpoint, the draft room, and `advance`'s auto-pick all go through `buildPoolEntries`, so they now get real projections (spec §7.4: queue → projection).

`lib/stats/pool.ts` imports only the *type* `PoolStatsLookup` from `lib/pool/entries.ts`, so the new import in the other direction is not a runtime cycle.

- [ ] **Step 6: Add a wiring test to SP4's pool tests**

Append to the test file SP4 wrote for `buildPoolEntries` (find it: `grep -rl "buildPoolEntries" tests`), inside its existing setup (which mocks `getTba` and `getRepo` with a memory repo and creates a round for a 2026 event whose pool includes `frc1`):

```ts
it('fills proj from team_stats by default (SP3)', async () => {
  await repo.upsertTeamStats([{
    teamKey: 'frc1', season: 2026, eventsPlayed: 2, totalPoints: 80, qualWins: 10, qualLosses: 4, qualTies: 0,
    bestFinish: 'captain', awards: [], events: [], latestEventKey: '2026pahat', latestOpr: 40.1, latestRank: 5,
    updatedAt: '2026-10-01T00:00:00.000Z',
  }]);
  const entries = await buildPoolEntries(round, NOW);
  const one = entries.find((e) => e.teamKey === 'frc1')!;
  expect(one.proj).toBe(40);
  expect(one.opr).toBe(40.1);
  expect(entries.find((e) => e.teamKey !== 'frc1')!.proj).toBeNull(); // everyone else is "New"
});
```

Use that file's own names for the repo, round, and clock (`repo`, `round`, `NOW` here). If its round is not a 2026 event, set `season: Number(round.startDate.slice(0, 4))` in the row instead of `2026`.

- [ ] **Step 7: Run everything and commit**

Run: `npm test && npm run typecheck`
Expected: all PASS, including SP4's auto-pick tests (they pass their own stats lookup or queue, so real projections don't change them; if one relied on the default being empty, pass `noPoolStats` in that test).

```bash
git add lib/stats/pool.ts lib/pool/entries.ts tests/stats/poolLookup.test.ts
git add -u tests   # SP4's buildPoolEntries test file (and any auto-pick test you adjusted)
git status --short # nothing else should be staged
git commit -m "feat(sp3): team_stats feed the draft pool and auto-pick"
```

---

### Task 15: Draft pool columns, sort, "New" chip, footnote

**Files:**
- Create: `lib/pool/sort.ts`, `components/pool/PoolStats.tsx`, `components/pool/PoolSortControl.tsx`
- Modify: SP4's pool list component (the Draft room's **Pool** tab; also used by the commissioner draft entry and round setup, spec §6.3)
- Test: `tests/pool/sort.test.ts`, `tests/ui/pool-stats.test.ts`

**Interfaces:**
- Consumes: `PoolEntry` (SP4); `BestFinish` (Task 1); v1 `Badge` (`components/ui/Badge.tsx`).
- Produces:
  ```ts
  // lib/pool/sort.ts
  export type PoolSortKey = 'proj' | 'opr' | 'number';
  export const POOL_SORTS: { key: PoolSortKey; label: string }[];   // Proj, OPR, Team #
  export function sortPool(entries: PoolEntry[], key: PoolSortKey): PoolEntry[];
  export function formatProj(proj: number | null): string;          // '38.2' | 'New'
  export function formatRecord(record: [number, number, number] | null): string;   // '12-4-0' | '—'
  export function formatOprRank(opr: number | null, rank: number | null): string;  // 'OPR 41.2 · #3'
  export const BEST_FINISH_LABEL: Record<BestFinish, string>;
  // components/pool/PoolStats.tsx
  export function NewChip(): JSX.Element;
  export function PoolStatCells(props: { entry: PoolEntry }): JSX.Element;
  export function PoolFootnote(): JSX.Element;                      // "Proj. uses standard scoring"
  // components/pool/PoolSortControl.tsx ('use client')
  export function PoolSortControl(props: { value: PoolSortKey; onChange: (key: PoolSortKey) => void }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing sort test**

Create `tests/pool/sort.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PoolEntry } from '@/lib/pool/entries';
import { formatOprRank, formatProj, formatRecord, sortPool } from '@/lib/pool/sort';

const e = (teamKey: string, proj: number | null, opr: number | null = null): PoolEntry => ({
  teamKey, nickname: null, proj, record: null, bestFinish: null, opr, rank: null, available: true,
});
const keys = (list: PoolEntry[]) => list.map((x) => x.teamKey);

describe('sortPool', () => {
  const pool = [e('frc341', 20), e('frc5181', null), e('frc103', 38.2), e('frc2607', 20), e('frc1', null), e('frc341B', 5)];

  it('Proj: highest first, ties by team number, "New" last (by team number)', () => {
    expect(keys(sortPool(pool, 'proj'))).toEqual(['frc103', 'frc341', 'frc2607', 'frc341B', 'frc1', 'frc5181']);
  });

  it('OPR: highest first, teams without OPR last', () => {
    const list = [e('frc1', null, 10), e('frc2', null, null), e('frc3', null, 30)];
    expect(keys(sortPool(list, 'opr'))).toEqual(['frc3', 'frc1', 'frc2']);
  });

  it('Team #: numeric, with B-teams right after their A-team', () => {
    expect(keys(sortPool(pool, 'number'))).toEqual(['frc1', 'frc103', 'frc341', 'frc341B', 'frc2607', 'frc5181']);
  });

  it('does not change the input array', () => {
    const copy = [...pool];
    sortPool(pool, 'proj');
    expect(pool).toEqual(copy);
  });
});

describe('formatting', () => {
  it('formats proj, record, and OPR/rank', () => {
    expect(formatProj(38.2)).toBe('38.2');
    expect(formatProj(40)).toBe('40.0');
    expect(formatProj(null)).toBe('New');
    expect(formatRecord([12, 4, 0])).toBe('12-4-0');
    expect(formatRecord(null)).toBe('—');
    expect(formatOprRank(41.23, 3)).toBe('OPR 41.2 · #3');
    expect(formatOprRank(41.2, null)).toBe('OPR 41.2');
    expect(formatOprRank(null, 7)).toBe('#7');
    expect(formatOprRank(null, null)).toBe('—');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails, then implement**

Run: `npx vitest run tests/pool/sort.test.ts` → FAIL (`Failed to resolve import "@/lib/pool/sort"`).

Create `lib/pool/sort.ts`:

```ts
import type { BestFinish } from '@/lib/db/types';
import type { PoolEntry } from '@/lib/pool/entries';

export type PoolSortKey = 'proj' | 'opr' | 'number';

export const POOL_SORTS: { key: PoolSortKey; label: string }[] = [
  { key: 'proj', label: 'Proj' },
  { key: 'opr', label: 'OPR' },
  { key: 'number', label: 'Team #' },
];

/** frc341 < frc341B < frc2607: by number, then the B suffix. */
function byTeam(a: string, b: string): number {
  return Number.parseInt(a.slice(3), 10) - Number.parseInt(b.slice(3), 10) || a.localeCompare(b);
}

/** Highest first; null ("New" / no OPR) always last. */
function highFirst(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return b - a;
}

/** Spec §6.3 sorts. Returns a new array. */
export function sortPool(entries: PoolEntry[], key: PoolSortKey): PoolEntry[] {
  return [...entries].sort((a, b) => {
    const primary = key === 'proj' ? highFirst(a.proj, b.proj) : key === 'opr' ? highFirst(a.opr, b.opr) : 0;
    return primary || byTeam(a.teamKey, b.teamKey);
  });
}

export function formatProj(proj: number | null): string {
  return proj === null ? 'New' : proj.toFixed(1);
}

export function formatRecord(record: [number, number, number] | null): string {
  return record ? `${record[0]}-${record[1]}-${record[2]}` : '—';
}

export function formatOprRank(opr: number | null, rank: number | null): string {
  const parts = [opr === null ? null : `OPR ${opr.toFixed(1)}`, rank === null ? null : `#${rank}`].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export const BEST_FINISH_LABEL: Record<BestFinish, string> = {
  winner: 'Event winner',
  finalist: 'Finalist',
  captain: 'Captain',
  picked: 'Picked',
};
```

Run: `npx vitest run tests/pool/sort.test.ts` → PASS.

- [ ] **Step 3: Write the failing component test**

Create `tests/ui/pool-stats.test.ts` (same render style as `tests/ui/round-components.test.ts`):

```ts
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PoolFootnote, PoolStatCells } from '@/components/pool/PoolStats';
import { PoolSortControl } from '@/components/pool/PoolSortControl';
import type { PoolEntry } from '@/lib/pool/entries';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const entry = (extra: Partial<PoolEntry> = {}): PoolEntry => ({
  teamKey: 'frc341', nickname: 'Miss Daisy', proj: 38.2, record: [12, 4, 0], bestFinish: 'winner',
  opr: 41.23, rank: 3, available: true, ...extra,
});

describe('PoolStatCells', () => {
  it('shows Proj, W-L-T, the best-finish badge, and OPR / rank', () => {
    const t = text(renderToStaticMarkup(h(PoolStatCells, { entry: entry() })));
    expect(t).toContain('38.2');
    expect(t).toContain('12-4-0');
    expect(t).toContain('Event winner');
    expect(t).toContain('OPR 41.2 · #3');
  });

  it('shows a "New" chip instead of Proj, and no badge for a team never picked', () => {
    const html = renderToStaticMarkup(h(PoolStatCells, { entry: entry({ proj: null, bestFinish: null, record: null, opr: null, rank: null }) }));
    expect(text(html)).toContain('New');
    expect(text(html)).not.toContain('proj');
    expect(text(html)).not.toMatch(/winner|Finalist|Captain|Picked/);
  });
});

describe('PoolFootnote', () => {
  it('says projections use standard scoring (spec §6.3)', () => {
    expect(text(renderToStaticMarkup(h(PoolFootnote)))).toBe('Proj. uses standard scoring');
  });
});

describe('PoolSortControl', () => {
  it('renders the three sorts as 44 px toggle buttons with the current one pressed', () => {
    const html = renderToStaticMarkup(h(PoolSortControl, { value: 'opr', onChange: () => {} }));
    expect(text(html)).toBe('Proj OPR Team #');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>OPR|>OPR<\/button>/);
    expect(html.match(/min-h-11/g)).toHaveLength(3);
  });
});
```

- [ ] **Step 4: Run it to make sure it fails, then implement**

Run: `npx vitest run tests/ui/pool-stats.test.ts` → FAIL (`Failed to resolve import "@/components/pool/PoolStats"`).

Create `components/pool/PoolStats.tsx`:

```tsx
import { Badge } from '@/components/ui/Badge';
import type { PoolEntry } from '@/lib/pool/entries';
import { BEST_FINISH_LABEL, formatOprRank, formatProj, formatRecord } from '@/lib/pool/sort';

/** Shown instead of a projection for teams with no results in the last two seasons. */
export function NewChip() {
  return <Badge tone="neutral">New</Badge>;
}

/** The stat line under a pool row's team name (spec §6.3): Proj · W-L-T · best finish · OPR / rank. */
export function PoolStatCells({ entry }: { entry: PoolEntry }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-[18px] text-fg-muted">
      {entry.proj === null ? (
        <NewChip />
      ) : (
        <span className="font-semibold tabular-nums text-fg">
          {formatProj(entry.proj)}
          <span className="font-normal text-fg-muted"> proj</span>
        </span>
      )}
      {entry.record && <span className="tabular-nums">{formatRecord(entry.record)}</span>}
      {entry.bestFinish && <Badge tone="neutral">{BEST_FINISH_LABEL[entry.bestFinish]}</Badge>}
      {(entry.opr !== null || entry.rank !== null) && (
        <span className="tabular-nums">{formatOprRank(entry.opr, entry.rank)}</span>
      )}
    </div>
  );
}

export function PoolFootnote() {
  return <p className="text-[13px] leading-[18px] text-fg-muted">Proj. uses standard scoring</p>;
}
```

Create `components/pool/PoolSortControl.tsx`:

```tsx
'use client';

import { POOL_SORTS, type PoolSortKey } from '@/lib/pool/sort';

export function PoolSortControl({ value, onChange }: { value: PoolSortKey; onChange: (key: PoolSortKey) => void }) {
  return (
    <div role="group" aria-label="Sort teams" className="flex gap-1">
      {POOL_SORTS.map((s) => {
        const on = s.key === value;
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(s.key)}
            className={[
              'min-h-11 rounded-pill px-3 text-[15px] font-semibold',
              on ? 'bg-primary-fill text-on-primary' : 'bg-surface-2 text-fg-muted ring-1 ring-inset ring-border',
            ].join(' ')}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
```

Run: `npx vitest run tests/ui/pool-stats.test.ts tests/pool` → PASS. (If the "not.toContain('proj')" line fails for the New case, the Proj span is rendering — check the `entry.proj === null` branch.)

- [ ] **Step 5: Wire them into SP4's pool list**

Find the component that renders `PoolEntry` rows:

Run: `grep -rln "PoolEntry" components app | grep -v "components/pool/"`

In that component (SP4's Pool tab list; it already filters "Available only" and searches by number or nickname):

1. Add sort state and apply it after filtering/search:
   ```tsx
   import { PoolFootnote, PoolStatCells } from '@/components/pool/PoolStats';
   import { PoolSortControl } from '@/components/pool/PoolSortControl';
   import { sortPool, type PoolSortKey } from '@/lib/pool/sort';
   // inside the component:
   const [sort, setSort] = useState<PoolSortKey>('proj'); // spec §6.3: Proj is the default
   const shown = sortPool(filtered, sort);                  // `filtered` = SP4's search + "Available only" result
   ```
2. Render `<PoolSortControl value={sort} onChange={setSort} />` in the list's toolbar, next to SP4's search box and "Available only" toggle. At 360 px the toolbar may wrap onto two lines; it must not scroll sideways.
3. In each row, under the bumper plate + nickname, replace SP4's stats placeholder (whatever it shows for the `null` stats — typically a "New" label) with `<PoolStatCells entry={e} />`.
4. Render `<PoolFootnote />` once, below the list.
5. Map over `shown` instead of `filtered`.

- [ ] **Step 6: Check it in the browser**

Run `npm run dev`, sign in, open a live-mode round's draft room (`/l/{slug}/r/{roundId}/draft`) → Pool tab, at 360 px wide in both themes. With `team_stats` still empty locally, every row shows the "New" chip and Proj sort falls back to team number; that's expected until Task 17. Sort buttons are ≥ 44 px tall and nothing scrolls sideways.

- [ ] **Step 7: Run everything and commit**

Run: `npm test && npm run typecheck` → all PASS.

```bash
git add lib/pool/sort.ts components/pool/PoolStats.tsx components/pool/PoolSortControl.tsx tests/pool/sort.test.ts tests/ui/pool-stats.test.ts
git add -u components app   # SP4's pool list component, edited in Step 5
git status --short          # nothing unexpected staged
git commit -m "feat(sp3): draft pool shows Proj, W-L-T, best finish, OPR/rank with sorting"
```

---

### Task 16: Team sheet (tap a pool row)

**Files:**
- Create: `app/api/l/[slug]/rounds/[id]/pool/[teamKey]/route.ts`, `components/pool/TeamSheet.tsx`
- Modify: SP4's pool list component (row tap opens the sheet)
- Test: `tests/api/teamSheet.test.ts`, `tests/ui/team-sheet.test.ts`

**Interfaces:**
- Consumes: `teamSheet`, `TeamSheetData` (Task 14); `getTeamStats` (Task 4); SP1 `requireLeagueView`; v1 `requireRound`, `handle`, `json`, `HttpError`, `TEAM_KEY_RE`, `teamLabel`; `BEST_FINISH_LABEL`, `formatProj`, `formatRecord` (Task 15); v1 `BumperPlate`.
- Produces:
  ```ts
  // GET /api/l/{slug}/rounds/{id}/pool/{teamKey} → 200 TeamSheetData; 403 private league (non-member); 404 unknown league/round/team key
  export function TeamSheetBody(props: { data: TeamSheetData; nickname: string | null }): JSX.Element;  // pure, testable
  export function TeamSheet(props: { slug: string; roundId: string; teamKey: string; nickname: string | null; onClose: () => void }): JSX.Element; // 'use client'
  ```

- [ ] **Step 1: Write the failing route test**

Create `tests/api/teamSheet.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  user: null as { id: string; email: string | null } | null,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
// Same idea as SP1's tests/helpers/auth.ts session mock: the "signed-in user" is whatever h.user is.
vi.mock('@/lib/auth/session', () => ({
  getUser: async () => h.user,
  requireUser: async () => h.user,
}));

import { GET } from '@/app/api/l/[slug]/rounds/[id]/pool/[teamKey]/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;
let round: RoundRow;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  h.user = null;
  ({ league } = await seedLeague(repo));
  round = await repo.createRound({
    leagueId: league.id, eventKey: '2026parr', eventName: 'Ramp Riot', startDate: '2026-10-24',
    endDate: '2026-10-24', timezone: 'America/New_York', scoring: defaultScoring(),
  });
  await repo.upsertTeamStats([{
    teamKey: 'frc341', season: 2026, eventsPlayed: 2, totalPoints: 80, qualWins: 12, qualLosses: 4, qualTies: 0,
    bestFinish: 'winner', awards: [{ type: 0, name: 'Impact', eventKey: '2026paca' }],
    events: [{ eventKey: '2026paca', name: 'Greater Pittsburgh', endDate: '2026-03-08', rank: 1, finish: 'winner', points: 50 }],
    latestEventKey: '2026paca', latestOpr: 55.5, latestRank: 1, updatedAt: '2026-10-01T00:00:00.000Z',
  }]);
});

const get = (teamKey: string, slug = league.slug, id = round.id) =>
  GET(request('GET', '/x'), params({ slug, id, teamKey }));

describe('GET …/pool/{teamKey}', () => {
  it('returns the history of a link-visible league to anyone, even signed out', async () => {
    const res = await get('frc341');
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.season).toBe(2026);
    expect(body.proj).toBe(40);
    expect(body.seasons[0].events[0].eventKey).toBe('2026paca');
    expect(body.seasons[0].awards[0].name).toBe('Impact');
  });

  it('returns an empty history (proj null) for a New team', async () => {
    const body = await readJson(await get('frc9999'));
    expect(body).toEqual({ teamKey: 'frc9999', season: 2026, proj: null, seasons: [] });
  });

  it('is 403 for non-members of a members-only league', async () => {
    await repo.updateLeague(league.id, { visibility: 'members' });
    expect((await get('frc341')).status).toBe(403);
    h.user = { id: 'stranger', email: null };
    expect((await get('frc341')).status).toBe(403);
  });

  it.each([
    ['a junk team key', () => get('341')],
    ['an unknown league', () => get('frc341', 'no-such-league')],
    ['a non-UUID round id', () => get('frc341', league.slug, 'not-a-uuid')],
  ])('is 404 for %s', async (_label, call) => {
    expect((await call()).status).toBe(404);
  });
});
```

If SP1 named the visibility field on `LeaguePatch` differently, use SP1's name in the `updateLeague` call.

- [ ] **Step 2: Run it to make sure it fails, then implement the route**

Run: `npx vitest run tests/api/teamSheet.test.ts` → FAIL (`Failed to resolve import`).

Create `app/api/l/[slug]/rounds/[id]/pool/[teamKey]/route.ts`:

```ts
import { handle, HttpError, json, requireRound } from '@/lib/api/http';
import { requireLeagueView } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { teamSheet } from '@/lib/stats/pool';
import { TEAM_KEY_RE } from '@/lib/teams';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string; id: string; teamKey: string }> };

/** Spec §6.3 team sheet: per-event history for the round's season Y and Y−1, from team_stats only. */
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id, teamKey } = await ctx.params;
    const { league } = await requireLeagueView(slug);
    const round = await requireRound(league, id);
    if (!TEAM_KEY_RE.test(teamKey)) throw new HttpError(404, 'Team not found');
    const season = Number(round.startDate.slice(0, 4));
    const rows = await getRepo().getTeamStats([teamKey], [season, season - 1], { withHistory: true });
    return json(teamSheet(teamKey, season, rows));
  });
}
```

Run: `npx vitest run tests/api/teamSheet.test.ts` → PASS.

- [ ] **Step 3: Write the failing sheet-body test**

Create `tests/ui/team-sheet.test.ts`:

```ts
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TeamSheetBody } from '@/components/pool/TeamSheet';
import type { TeamSheetData } from '@/lib/stats/pool';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ').trim();

const data: TeamSheetData = {
  teamKey: 'frc341',
  season: 2026,
  proj: 38.2,
  seasons: [
    {
      season: 2026, eventsPlayed: 1, totalPoints: 50, record: [8, 2, 0], bestFinish: 'winner',
      events: [{ eventKey: '2026paca', name: 'Greater Pittsburgh', endDate: '2026-03-08', rank: 1, finish: 'winner', points: 50 }],
      awards: [{ type: 0, name: 'FIRST Impact Award', eventKey: '2026paca' }],
    },
    { season: 2025, eventsPlayed: 2, totalPoints: 30, record: [10, 10, 0], bestFinish: null, events: [], awards: [] },
  ],
};

describe('TeamSheetBody', () => {
  it('shows the team, the projection, and each season newest first', () => {
    const t = text(renderToStaticMarkup(h(TeamSheetBody, { data, nickname: 'Miss Daisy' })));
    expect(t).toContain('Miss Daisy');
    expect(t).toContain('38.2');
    expect(t.indexOf('2026')).toBeLessThan(t.indexOf('2025'));
    expect(t).toContain('8-2-0');
  });

  it('lists each event with rank, finish, and fantasy points, plus awards', () => {
    const t = text(renderToStaticMarkup(h(TeamSheetBody, { data, nickname: null })));
    expect(t).toContain('Greater Pittsburgh');
    expect(t).toContain('#1');
    expect(t).toContain('Event winner');
    expect(t).toContain('+50');
    expect(t).toContain('FIRST Impact Award');
  });

  it('says so plainly for a New team', () => {
    const t = text(renderToStaticMarkup(h(TeamSheetBody, { data: { teamKey: 'frc9999', season: 2026, proj: null, seasons: [] }, nickname: null })));
    expect(t).toContain('New');
    expect(t).toContain('No results in 2025 or 2026');
  });

  it('includes the standard-scoring footnote', () => {
    expect(text(renderToStaticMarkup(h(TeamSheetBody, { data, nickname: null })))).toContain('Proj. uses standard scoring');
  });
});
```

- [ ] **Step 4: Run it to make sure it fails, then implement the sheet**

Run: `npx vitest run tests/ui/team-sheet.test.ts` → FAIL (`Failed to resolve import`).

Create `components/pool/TeamSheet.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { PoolFootnote } from '@/components/pool/PoolStats';
import { BumperPlate } from '@/components/ui/BumperPlate';
import { BEST_FINISH_LABEL, formatProj, formatRecord } from '@/lib/pool/sort';
import type { TeamSheetData } from '@/lib/stats/pool';
import { teamLabel } from '@/lib/teams';

/** The sheet's content. Pure, so it renders in tests without fetching. */
export function TeamSheetBody({ data, nickname }: { data: TeamSheetData; nickname: string | null }) {
  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <BumperPlate number={teamLabel(data.teamKey)} size="lg" />
        <div className="min-w-0">
          {nickname && <p className="truncate text-[17px] font-semibold text-fg">{nickname}</p>}
          <p className="text-[15px] text-fg-muted">
            Proj <span className="font-semibold tabular-nums text-fg">{formatProj(data.proj)}</span>
          </p>
        </div>
      </header>

      {data.seasons.length === 0 && (
        <p className="text-[15px] text-fg-muted">
          No results in {data.season - 1} or {data.season} yet, so this team is New.
        </p>
      )}

      {data.seasons.map((s) => (
        <section key={s.season} className="space-y-2">
          <h3 className="text-[15px] font-semibold text-fg">
            {s.season} · {s.eventsPlayed} {s.eventsPlayed === 1 ? 'event' : 'events'} · {s.totalPoints} pts ·{' '}
            <span className="tabular-nums">{formatRecord(s.record)}</span>
          </h3>
          <ul className="divide-y divide-border rounded-card bg-surface-2">
            {s.events.map((e) => (
              <li key={e.eventKey} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-[15px]">
                <span className="min-w-0">
                  <span className="block truncate text-fg">{e.name}</span>
                  <span className="text-[13px] text-fg-muted">
                    {e.rank !== null ? `#${e.rank}` : 'No rank'}
                    {e.finish ? ` · ${BEST_FINISH_LABEL[e.finish]}` : ''}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-fg">+{e.points}</span>
              </li>
            ))}
          </ul>
          {s.awards.length > 0 && (
            <ul className="space-y-1 text-[13px] text-fg-muted">
              {s.awards.map((a) => (
                <li key={`${a.eventKey}-${a.type}`}>Award: {a.name}</li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <PoolFootnote />
    </div>
  );
}

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: TeamSheetData };

/** Bottom sheet opened by tapping a pool row (spec §6.3). */
export function TeamSheet({
  slug,
  roundId,
  teamKey,
  nickname,
  onClose,
}: {
  slug: string;
  roundId: string;
  teamKey: string;
  nickname: string | null;
  onClose: () => void;
}) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    fetch(`/api/l/${encodeURIComponent(slug)}/rounds/${roundId}/pool/${teamKey}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as TeamSheetData;
      })
      .then((data) => !cancelled && setLoad({ status: 'ready', data }))
      .catch(() => !cancelled && setLoad({ status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [slug, roundId, teamKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Team ${teamLabel(teamKey)} history`}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-card bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex justify-end">
          <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-pill text-[15px] font-semibold text-fg-muted">
            Close
          </button>
        </div>
        {load.status === 'loading' && <p className="text-[15px] text-fg-muted">Loading…</p>}
        {load.status === 'error' && <p className="text-[15px] text-fg-muted">Couldn&apos;t load this team&apos;s history.</p>}
        {load.status === 'ready' && <TeamSheetBody data={load.data} nickname={nickname} />}
      </div>
    </div>
  );
}
```

If a token class used here (`rounded-card`, `rounded-t-card`, `bg-surface`, `divide-border`) doesn't exist in `app/globals.css`, use the equivalent the v1 `Card` component (`components/ui/Card.tsx`) uses.

Run: `npx vitest run tests/ui/team-sheet.test.ts` → PASS.

- [ ] **Step 5: Open the sheet from a pool row**

In SP4's pool list component (same file as Task 15 Step 5), make the row's team area a button that opens the sheet, keeping SP4's separate Draft / Add-to-queue buttons as they are:

```tsx
import { TeamSheet } from '@/components/pool/TeamSheet';
// inside the component:
const [sheet, setSheet] = useState<PoolEntry | null>(null);
// in each row, wrap the plate + nickname + <PoolStatCells> block:
<button type="button" className="min-h-11 min-w-0 flex-1 text-left" onClick={() => setSheet(e)}>
  {/* existing plate + nickname + <PoolStatCells entry={e} /> */}
</button>
// once, after the list:
{sheet && (
  <TeamSheet slug={slug} roundId={roundId} teamKey={sheet.teamKey} nickname={sheet.nickname} onClose={() => setSheet(null)} />
)}
```

Use the component's existing names for the league slug and round id props.

- [ ] **Step 6: Browser check**

`npm run dev` → draft room Pool tab at 360 px, both themes: tap a row → the sheet slides up, scrolls on its own, Close and Escape dismiss it, tapping the dim backdrop dismisses it. A New team shows the "No results …" line.

- [ ] **Step 7: Run everything and commit**

Run: `npm test && npm run typecheck` → all PASS.

```bash
git add "app/api/l/[slug]/rounds/[id]/pool/[teamKey]/route.ts" components/pool/TeamSheet.tsx tests/api/teamSheet.test.ts tests/ui/team-sheet.test.ts
git add -u components app   # SP4's pool list component, edited in Step 5
git status --short          # nothing unexpected staged
git commit -m "feat(sp3): team sheet with per-event history for Y and Y−1"
```

---

### Task 17: Apply `0004`, backfill hashes, build 2025 + 2026 stats (with Joey)

**Files:** none changed (this task runs the migration and scripts against the real database).

**Interfaces:**
- Consumes: `0004_team_stats.sql` (Task 1), `scripts/backfill-body-hash.ts` (Task 3), `scripts/build-team-stats.ts`, `scripts/show-team-stats.ts` (Task 11).
- Produces: a filled `team_stats` for 2025 and 2026 (Ramp Riot projections = 2026 ×2 + 2025 ×1), and the numbers for the PR description.

v1 has one Supabase project, used by both local dev and the live site, so **these steps change production data**. They are safe: the migration only adds a column and two tables, and the scripts only write the new derived tables and `tba_cache`. The live site (still on the pre-SP3 code) ignores all three.

- [ ] **Step 1: Wake the database**

Joey: Supabase dashboard → the FRC Fantasy project. If it says *Paused*, click **Restore** and wait until it's green.

- [ ] **Step 2: Apply the migration**

Joey: Supabase dashboard → **SQL Editor** → New query → paste all of `supabase/migrations/0004_team_stats.sql` → **Run**.
Expected: `Success. No rows returned`. Then **Table Editor** shows `event_scores` and `team_stats` (both empty), and `tba_cache` has a `body_hash` column.

- [ ] **Step 3: Backfill the hashes**

Run: `npx tsx --env-file=.env.local scripts/backfill-body-hash.ts`
Expected: `Done: N rows hashed.` where N is the number of `tba_cache` rows with a body (a few dozen).

- [ ] **Step 4: Build 2025**

Run: `npx tsx --env-file=.env.local scripts/build-team-stats.ts 2025`
Expected: one line per event (`[1/NNN] 2025…  NN teams`), ending with roughly `Done: 2025 — 300–400 events, 3,000–3,800 team rows, NN events with no played quals (… s).` The first run takes about 8–15 minutes (six TBA requests per event at 5 per second, plus database time). If it stops for any reason (laptop sleeps, network drops), run the same command again: everything already downloaded is read back from `tba_cache` in seconds.

- [ ] **Step 5: Build 2026**

Run: `npx tsx --env-file=.env.local scripts/build-team-stats.ts 2026`
Expected: the same shape of output for 2026. Offseason events that already happened (with played quals) are included.

- [ ] **Step 6: Spot-check against The Blue Alliance**

Run: `npx tsx --env-file=.env.local scripts/show-team-stats.ts 5181 2026`
Expected: 5181's 2026 events, ranks, and finishes match its page on thebluealliance.com, and the last line prints a number (`Proj for a 2026 draft: …`), not `New`.

Run: `npx tsx --env-file=.env.local scripts/show-team-stats.ts 2607 2025`
Expected: the event list includes `2025parr` with rank 3 and finish `winner` (the fixture facts).

- [ ] **Step 7: Check storage**

Joey: Supabase dashboard → **Project Settings → Usage** (or Reports → Database). Expected: database size grew by roughly 50–80 MB (spec §6.2 estimate: ~25–30 MB of `tba_cache` per season, plus the derived tables) and is far below the 500 MB free-tier limit. Write the number down for the PR.

- [ ] **Step 8: Local draft room check**

`npm run dev`, sign in, open a live-mode round's draft room → Pool tab (360 px, both themes). Expected: real Proj numbers, sorted highest first; a few "New" chips (rookies); W-L-T, finish badges, OPR/rank on each row; the footnote; tapping a row opens the team sheet with 2026 and 2025 history.

Nothing to commit in this task. Keep the Step 4–7 numbers for the PR description.

---

### Task 18: Docs — README, CLAUDE.md, `.env.example`

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `.env.example`

**Interfaces:** none (documentation only; spec §13).

- [ ] **Step 1: README scripts table**

In `README.md` under `## Scripts`, add these rows to the table (keep the existing rows that SP1 left):

```markdown
| `scripts/build-team-stats.ts <season>` | Builds the draft-pool stats (`team_stats`) for one season from TBA, ~5 requests/s. Safe to stop and rerun. Run for the last two seasons before a draft |
| `scripts/show-team-stats.ts <team> <season>` | Prints one team's stats rows and the projection a draft in that season shows |
| `scripts/rebuild-event-scores.ts` | Empties the `event_scores` cache. **Run it on production after any change to `lib/scoring/*`** (cached rows hold the old code's scores) |
| `scripts/backfill-body-hash.ts` | One-time, after migration 0004: fills `tba_cache.body_hash` for old rows |
```

- [ ] **Step 2: README cron section**

Add a section after `## Scripts`:

```markdown
## Daily cron

Vercel calls `GET /api/cron/daily` once a day (06:00 Eastern, `vercel.json`). It needs `CRON_SECRET` set in Vercel's
environment variables; Vercel sends it as `Authorization: Bearer …` automatically. Each run gets 50 seconds:

- **team-stats** — re-scores this season's events from the last 8 days and refreshes those teams' `team_stats` rows.
  If it runs out of time it says so in the log, and the next day's run continues with the teams it missed.

To run it by hand (for example right after an event): 
`curl -H "Authorization: Bearer $CRON_SECRET" https://frc-fantasy-6yo3.vercel.app/api/cron/daily`
Logs: Vercel dashboard → the project → Logs, filter by `/api/cron/daily`. The daily call also keeps the Supabase
free-tier project from pausing.
```

- [ ] **Step 3: CLAUDE.md locked caching decision**

In `CLAUDE.md` under `## Locked decisions`, replace the **Caching** bullet with (spec §5.6 wording):

```markdown
- **Caching:** Next.js caching is disabled (`force-dynamic`, `no-store`). `tba_cache` is the only cache of *TBA data*; `event_scores` and `team_stats` are derived, rebuildable caches of *computed* values (truncate them any time; `scripts/rebuild-event-scores.ts`, `scripts/build-team-stats.ts`).
```

and extend the **Scores are computed, never stored** bullet with: ` The derived caches above are the only exception, and they are rebuildable.`

Under `## Current status`, add a line: `- v2 SP3 (team info): event_scores cache, team_stats (2025 + 2026 built), draft-pool stats, daily cron.`

- [ ] **Step 4: `.env.example`**

Make sure `.env.example` has a `CRON_SECRET=` line (SP1's setup may have added it; add it if not). It is only needed locally to call the cron route by hand.

- [ ] **Step 5: Run the checks and commit**

Run: `npm test && npm run typecheck` → all PASS (nothing in code changed; this guards against a stray edit).

```bash
git add README.md CLAUDE.md .env.example
git commit -m "docs(sp3): scripts, daily cron, caching rule wording"
```

---

### Task 19: Merge SP3 (PR → merge → production check)

**Files:** none new.

Push, PR, and merge are separate explicit asks from Joey (working style): **stop and ask before Step 2, and again before Step 3.**

- [ ] **Step 1: Full local gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean; every test passes (the count is the SP4 baseline plus roughly 90 new SP3 tests); the build succeeds and lists `/api/cron/daily` as a dynamic route (`ƒ`).

Check commit trailers with the `subagent-commit-trailers` skill if subagents made the commits.

- [ ] **Step 2: Push and open the PR (after Joey says so)**

```bash
git push -u origin v2-sp3-team-info
gh pr create --title "v2 SP3: event_scores cache + draft-pool team info" --body "$(cat <<'BODY'
## What
- `event_scores`: derived cache over `scoreEvent`, keyed by event + scoring-config hash, invalidated by `tba_cache` body hashes (spec §5.6). Round and league pages read through it; `2025parr` replay matches v1 exactly.
- `team_stats`: per team per season (default scoring) — projection, W-L-T, best finish, OPR/rank, per-event history, awards (spec §6).
- Draft pool shows Proj / W-L-T / best finish / OPR·rank, sorts by Proj, OPR, or team number, and opens a team sheet. Auto-pick now uses real projections.
- Daily cron `/api/cron/daily` (50 s budget) refreshes this season's recent teams.

## Data (Task 17)
- 2025: <events> events, <rows> team rows. 2026: <events> events, <rows> team rows.
- Database size after build: <MB> MB of 500 MB.

## Spec deviations
See the plan's "Deviations from the spec" section (extra `info` column; `getEventScores` returns `info` and takes `opts`; resumability via `tba_cache`; least-recently-updated-first cron order).

## Checks
- `npm run typecheck`, `npm test` (<count> passing), `npm run build`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

Fill in the `<…>` values from Task 17 and Step 1 before running it.

- [ ] **Step 3: Merge (after Joey says so)**

Joey merges the PR on GitHub (or: `gh pr merge --squash --delete-branch` if he asks you to). Vercel deploys `main` automatically. Migration `0004` is already applied (Task 17).

- [ ] **Step 4: Production checks**

1. Vercel → the project → **Settings → Environment Variables**: `CRON_SECRET` exists for Production (added during SP1's one-time setup, spec §11). If not, add a random 32+ character value and **Redeploy**.
2. Vercel → **Settings → Cron Jobs** lists `/api/cron/daily` with schedule `0 10 * * *`.
3. Run by hand:
   `curl -s -H "Authorization: Bearer $CRON_SECRET" https://frc-fantasy-6yo3.vercel.app/api/cron/daily`
   Expected: `{"ok":true,"results":[{"name":"team-stats","ok":true,"skipped":false,"ms":…}]}`.
   `curl -s -o /dev/null -w "%{http_code}\n" https://frc-fantasy-6yo3.vercel.app/api/cron/daily`
   Expected: `401`.
4. Open a league page and a round page on the live site twice. Expected: same scores as before the deploy; Supabase **Table Editor → event_scores** now has rows for those events.
5. Open a live-mode round's draft room on a phone: Pool tab shows projections; tap a team → team sheet.

- [ ] **Step 5: Wrap up**

Switch back to `main` and pull. Report to Joey in 3–5 lines (test count, stats row counts, database size, cron result) and **stop**. SP2 (formats) starts only on Joey's "go".

---

## Self-review (done while writing)

- **Spec coverage:** every row of the coverage map points at a task; §6.3's "Search by number or nickname" and "Available only" belong to SP4's pool list and are kept, not rebuilt. §5.5 (season rounds) is SP2; `getEventScores` takes its window per call so SP2 can pass each event's own window.
- **Contract names produced exactly:** `getEventScores`, `serializeEventScores`, `deserializeEventScores` (re-exported from `lib/scores/eventScores.ts`), `getCacheMeta`, `getEventScoresRow`, `upsertEventScoresRow`, `getTeamStats`, `upsertTeamStats`, `teamStatsPoolLookup`, `projection`, `DAILY_JOBS` with `{ name, run(now, deadline) }`, `app/api/cron/daily/route.ts`. Additions beyond the contract: `getEventScores` returns `info` and takes `opts`; `projection` takes `SeasonTotals | null` (the contract's `{ points; events } | null`); repo gains `clearEventScores`; `getTeamStats` takes an optional `{ withHistory }`.
- **Type consistency:** `BestFinish` (Task 1) is the same union as `PoolEntry['bestFinish']` (SP4); `TeamEventSummary` fields are used identically in Tasks 9–12; `StatsDeps` is the one deps shape for the builder and the cron job.
- **Review Focus:** each of the five lines has a named test (Tasks 2, 6, 9, 12, 14).
