# FRC Fantasy v2 — SP2 League Formats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two league formats from spec §5 — event-by-event leagues with TBA *or* manual rounds plus automatic "follow a team" rounds, and full-season leagues that draft once and score every official event — on top of SP1 (accounts), SP4 (live draft) and SP3 (`event_scores`, team stats).

**Architecture:** A round gains a `kind` (`tba` | `manual` | `season`). One dispatcher (`lib/rounds/scoreSource.ts`) turns any round into the same `EventScores`-style team map, so `scoreRound`, standings, the Me tab and the draft room don't care which kind it is: `tba` rounds keep SP3's `getEventScores` path, `manual` rounds run the new pure `scoreManualEvent` over typed-in results, and `season` rounds sum `getEventScores` across each drafted team's official events under a fetch budget. Follow-a-team is a pure event filter plus an idempotent sync (`on conflict do nothing`) triggered by the SP3 daily cron and by page visits through `after()`.

**Tech Stack:** Next.js 16.3 (App Router, `after()` from `next/server`), React 19, TypeScript strict, Tailwind 4, Supabase Postgres (`@supabase/supabase-js` 2), zod 4, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-30-frc-fantasy-v2-design.md` — §5.1–§5.5 (this plan), §4.6 (Me tab season rows), §8.2 (migration `0005_formats.sql`). §5.6 `event_scores` was built by SP3; this plan only consumes it. Plan index and cross-plan contract: `docs/superpowers/plans/2026-09-30-frc-fantasy-v2.md`.

**Build position:** SP2 is built **4th and last**, and it is the first thing cut if the schedule slips (spec §10). Everything in SP1, SP4 and SP3 already exists when this plan starts. If a file named here from an earlier plan looks different from what this plan assumes, keep the earlier plan's code and adapt the snippet — the contract names in the index are the fixed points.

## Global Constraints

All constraints in `docs/superpowers/plans/2026-09-30-frc-fantasy-v2.md` ("Global Constraints") apply to every task. SP2-specific ones, copied from the spec:

- **`format` is chosen at creation and cannot change afterwards.** v1 leagues migrate as `event`. Values: `'event' | 'season'`. (§5.1)
- Round kinds: `'tba' | 'manual' | 'season'`. `(kind = 'tba') = (event_key is not null)`; `(kind = 'season') = (season_year is not null)`. (§5.2)
- `event_name`, `start_date`, `end_date`, `timezone` stay required for every kind. Manual timezone defaults to `America/New_York`; season timezone is `America/New_York`. (§5.2, §5.3, §5.5)
- **Roster size: 1–10 for `tba`/`manual`** (app rule), **1–15 for `season`** (DB check `between 1 and 15`). Season rounds default to **8**. (§5.2, §5.5)
- Event leagues get **Add round → TBA event | Manual event**; season leagues get **no "Add round"**. (§5.2)
- Manual round name 1–80 chars; `endDate ≥ startDate`. Manual results only for `manual` rounds (409 otherwise); team must be in the pool (400 otherwise). Manual rounds are **not** cached in `event_scores`. (§5.3)
- `manual_results` limits: qual W/L/T 0–50, RP 0–500 or null, qual rank 1–200 or null, playoff wins 0–20, alliance role `captain|pick1|pick2|pick3|backup` or null, event result `winner|finalist` or null. Unknown (`null`) RP or rank emits no line. `scoreManualEvent` never emits `oprBonus`; `qualsComplete = results.length > 0`; `rpMethod = 'manual'`. (§5.3)
- **Follow teams: up to 3 team numbers**, event leagues only; opt-in (the migration creates no follows). v1's `home_team_number` is removed from the UI/API (column dropped in `0006`). (§5.4)
- Follow sync keeps events with `event_type` **not** in {100 preseason, −1 unlabeled} (**offseason 99 is included**), `end_date ≥ today − 1 day`, not already a round, and not in `league_skipped_events`. Auto rounds copy `scoring` = league default, `roster_size` and `draft_order` from the league's **most recently created** round (order filtered to players whose accounts are still linked; roster size **4** if no round exists). Insert with `on conflict (league_id, event_key) do nothing`. (§5.4)
- Sync triggers: daily cron `GET /api/cron/daily` on schedule **`0 10 * * *`** (UTC, `Authorization: Bearer $CRON_SECRET`), and **on visit** of `/l/{slug}` or the admin dashboard via `after()` when `follows_synced_at` is null or **older than 10 minutes**. A TBA failure during sync is logged and ignored (no rounds created, `follows_synced_at` not updated). (§5.4)
- Deleting an **auto-added** round inserts `league_skipped_events` so it never returns; deleting a manually added round does not. Auto rounds show "Auto-added · following 5181". (§5.4)
- Season year at creation: **current year, or next year from October on**. One `season` round per season year, `event_name = "{year} Season"`. "Start {year + 1} season" appears once the latest season round is Final and copies the draft order. (§5.5)
- Season dates = earliest start / latest end of that year's **official** events from `/events/{year}/simple`, refreshed by the daily cron; before TBA publishes the calendar: **Jan 1 – Dec 31**. (§5.5)
- **Official events:** `event_type ∈ {0 Regional, 1 District, 2 District Championship, 3 Championship Division, 4 Championship Finals, 5 District Championship Division}`. Offseason (99) and preseason (100) never count for season scoring. (§5.5)
- Pool filters (`pool_filter` jsonb, zod-validated), editable only while the round has no picks (and, per SP4, before `draft_started_at`): `{ "type": "all" }` (default; `/teams/{year}/{page}/simple`, pages 0.. until an empty page, **24 h window per page**), `{ "type": "district", "key": "2027fma" }` (`/district/{key}/teams/simple`; picker lists `/districts/{year}`), `{ "type": "state", "country": "USA", "state": "Pennsylvania" }`, `{ "type": "country", "country": "Canada" }`. (§5.5)
- Empty season pool message, verbatim: **"TBA hasn't published {year} teams yet — usually by January."** v1's `P × R ≤ T` check applies. (§5.5)
- Season cache windows: each event uses `cacheWindowFor` on that event's own `RoundTiming` — `start_date`/`end_date` from Event_Simple, `timezone = 'America/New_York'`, `finalizedAt` = the season round's. (§5.5)
- **Season fetch budget:** at most **4** refreshes in flight and a **6-second** budget per page view; events not refreshed in time are served from existing cached data and marked stale. (§5.5)
- Season round page: per player, each team shows a season total, expandable to per-event subtotals, each expandable to v1-style lines; upcoming events show "Next: {event} · {date}". Status uses v1 rules with the season's dates. (§5.5)

## Deviations from the spec (flagged for Joey)

1. **Season per-event rows read "{date} · {event} · +41", not "Week 1 · …".** TBA's Event_Simple (the list we already fetch per team) has no `week` field; fetching the full event for every event just to label it would double the season page's TBA traffic. The date carries the same information.
2. **"At most 4 TBA fetches in flight" is implemented as at most 4 *event refreshes* in flight.** One event refresh is `getEventScores`, which (as in v1's `loadEventData`) fetches its six paths in parallel. Capping individual paths would mean rewriting SP3's module; capping whole events keeps the same protection against a Saturday fan-out (≤ 24 requests in flight, all bounded by the 5 s TBA timeout).
3. **"Other award" is TBA award type 70 (`OTHER`).** The manual awards picker needs a numeric id for `award_types integer[]`; 70 is TBA's own "Other" id, so it scores with `awards.default` unless a league's config says otherwise.
4. **The manual "Results tab" is a Results card.** The v1 round admin page is a stack of cards (Setup, Draft, Adjustments, Data), not tabs; Results is a card placed after Draft, shown only for manual rounds.
5. **Manual rounds are left out of the Me tab's "Live now / Up next" card.** That card reads upcoming matches from TBA, and manual events have none; their points still count everywhere else.

## Review Focus

Inputs the spec implies but no happy-path test exercises, most likely to bite first. Each is pinned by a test in the named task.

1. **The commissioner deletes an auto-added round, then the next sync (cron or a page visit) runs** → the round stays gone; deleting a round they added by hand and re-adding its event still works. *Tests in Task 9 (delete → skipped) and Task 8 (sync skips skipped events).*
2. **Two syncs run at the same moment (the 10:00 UTC cron and someone opening the league page)** → no duplicate rounds and no error; each event appears once. *Test in Task 2 (`createRoundIfAbsent` returns null on conflict) and Task 8 (two concurrent `syncFollowedEvents` calls).*
3. **The commissioner types a team for a manual result as `341`, ` frc341 `, or a team that isn't in the round's pool** → the first two save as `frc341`; the last gets "That team isn't in this round's team pool" (400), never a 500. *Test in Task 6.*
4. **TBA is down or slow while a season league page loads on a competition Saturday** → the page still renders within the time budget, with totals from cached data and a stale marker; a drafted team with no official events yet scores 0 and shows its next event. *Tests in Task 13 (budget) and Task 14 (season scoring with failing/slow TBA).*
5. **A season league is created in October for next year, before TBA has published the team list** → the pool is empty and the draft can't start, with "TBA hasn't published 2027 teams yet — usually by January." instead of "There are only 0 teams". *Test in Task 12.*

## File Structure

```
supabase/migrations/0005_formats.sql            new: §5.1–§5.4 schema (Task 1)
lib/db/types.ts                                 RoundKind, LeagueFormat, ManualResultRow; RoundRow/LeagueRow fields (Task 1)
lib/db/repo.ts                                  NewRound/RoundPatch/LeaguePatch fields + new Repo methods (Tasks 1–2)
lib/db/supabaseRepo.ts                          mappers + new methods (Tasks 1–2)
tests/helpers/memoryRepo.ts                     same, in memory (Tasks 1–2)
lib/season/poolFilter.ts                        PoolFilter zod schema + helpers (Task 1; used from Task 11)
lib/scoring/types.ts                            RpMethod += 'manual' (Task 3)
lib/scoring/awardTypes.ts                       AWARD_CHOICES + awardName() (Task 3)
lib/scoring/manual.ts                           ManualResult type + scoreManualEvent() (Task 3)
lib/rounds/scoreSource.ts                       scoreSourceFor(): one scoring entry point per round kind (Task 5, season in Task 15)
lib/rounds/pool.ts                              loadPool: manual (Task 5) + season pools (Task 12)
lib/views/round.ts                              buildRoundView uses scoreSourceFor (Task 5, 15)
app/api/l/[slug]/admin/rounds/route.ts          POST: TBA or manual round; 409 for season leagues (Task 5)
app/api/l/[slug]/admin/rounds/[id]/route.ts     PATCH roster 1–15 rule + poolFilter; DELETE → skipped (Tasks 9, 12)
app/api/l/[slug]/admin/rounds/[id]/refresh/route.ts  409 for non-TBA rounds (Task 5)
app/api/l/[slug]/admin/rounds/[id]/results/[teamKey]/route.ts  PUT/DELETE manual results (Task 6)
lib/rounds/detail.ts + lib/api/types.ts         kind, manualResults, poolFilter, maxRosterSize 15 (Tasks 5, 6, 12)
components/admin/ManualResultsEditor.tsx        Results tab (Task 7)
components/admin/AddManualRoundForm.tsx         "Manual event" add form (Task 7)
lib/follow/filter.ts                            pickFollowEvents() pure filter (Task 8)
lib/follow/sync.ts                              syncFollowedEvents() (Task 8), maybeSyncOnVisit() (Task 10)
app/api/l/[slug]/admin/follows/route.ts         PUT follows (≤ 3) (Task 9)
components/admin/FollowTeamsForm.tsx            settings UI (Task 9)
lib/cron/jobs.ts                                DAILY_JOBS += follow-sync (Task 10), season-dates (Task 17)
lib/season/calendar.ts                          pure: defaultSeasonYear, OFFICIAL_EVENT_TYPES, seasonDates() (Task 11)
lib/season/fetchDates.ts                        fetchSeasonDates() from TBA's calendar (Task 11)
lib/tba/types.ts                                EventSimple, DistrictSimple, TeamSimple.state_prov/country (Task 11)
lib/season/pool.ts                              loadSeasonTbaTeams() for the four filters (Task 12)
app/api/districts/[year]/route.ts               district picker data (Task 12)
lib/season/budget.ts                            createFetchBudget() (Task 13)
lib/season/score.ts                             scoreSeasonRound() (Task 14)
components/SeasonRosterList.tsx                 season round page breakdown (Task 15)
lib/leagues/formatSetup.ts                      format options at league creation (Task 16)
app/api/leagues/route.ts + components/CreateLeagueForm.tsx  format, season year, pool filter, follows (Task 16)
app/api/l/[slug]/admin/seasons/route.ts         "Start {year+1} season" (Task 17)
lib/season/next.ts                              pure: nextSeasonYear, nextPoolFilter (Task 17)
lib/season/jobs.ts                              seasonDatesJob for the daily cron (Task 17)
lib/season/current.ts                           Me-tab "current event" for season picks (Task 18)
tests/…                                         one test file per module above
```

**Why this shape:** each format concern is one small module with a pure core (`scoreManualEvent`, `pickFollowEvents`, `seasonDates`, `createFetchBudget`, `seasonCurrentEvent`) and a thin I/O wrapper, so every rule in §5 has a fast unit test. `scoreSourceFor` is the single seam where round kinds differ; everything downstream (standings, rosters, Me tab, draft room) keeps consuming a `Map<teamKey, TeamScore>`.

## Test conventions for this plan

Route tests follow v1 (`tests/api/*.test.ts`): mock `@/lib/db` with an in-memory repo and `@/lib/tba/client` with a fake `getTba`. Sessions follow the SP1 contract: `lib/auth/session.ts` is mocked and backed by a mutable user. Every route test file in this plan starts with this block (if SP1's `tests/helpers/auth.ts` exports an equivalent helper, use it instead — the behavior is the same):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/lib/auth/session';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  user: null as SessionUser | null,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));
vi.mock('@/lib/auth/session', async () => {
  const { HttpError } = await import('@/lib/api/http');
  return {
    getUser: async () => h.user,
    requireUser: async () => {
      if (!h.user) throw new HttpError(401, 'Sign in first');
      return h.user;
    },
  };
});
```

`seedLeague(repo)` (SP1 version, `tests/helpers/api.ts`) returns `{ league, commissioner, user }`; tests set `h.user = user` to act as the commissioner.

Run a single file with `npx vitest run tests/path/file.test.ts`; the full gate is `npm run typecheck && npm test`.

---

### Task 1: Migration `0005_formats.sql`, round kinds and league format in the types and repos

**Files:**
- Create: `supabase/migrations/0005_formats.sql`
- Create: `lib/season/poolFilter.ts`
- Modify: `lib/db/types.ts`, `lib/db/repo.ts`, `lib/db/supabaseRepo.ts`, `tests/helpers/memoryRepo.ts`
- Modify (null `eventKey` fallout): `lib/rounds/pool.ts`, `lib/views/round.ts`, `lib/rounds/detail.ts`, `lib/api/types.ts`, `app/api/l/[slug]/admin/state/route.ts`, `app/api/l/[slug]/admin/rounds/[id]/refresh/route.ts`, `app/l/[slug]/r/[roundId]/page.tsx`, `components/admin/AdminDashboard.tsx`
- Test: `tests/db/formatsRepo.test.ts`, `tests/db/migration0005.test.ts`, `tests/api/refresh.test.ts` (add one case)

**Interfaces:**
- Consumes: SP1 `seedLeague(repo)` → `{ league, commissioner, user }`; SP4's `RoundRow` draft fields (unchanged here).
- Produces:
  - `type LeagueFormat = 'event' | 'season'`, `type RoundKind = 'tba' | 'manual' | 'season'` (`lib/db/types.ts`)
  - `LeagueRow` += `format: LeagueFormat; followsSyncedAt: string | null`
  - `RoundRow.eventKey: string | null` (was `string`); `RoundRow` += `kind: RoundKind; seasonYear: number | null; poolFilter: PoolFilter | null; autoAdded: boolean`
  - `NewRound` = `{ leagueId; eventKey: string | null; eventName; startDate; endDate; timezone; scoring; kind?; seasonYear?; poolFilter?; autoAdded?; rosterSize?; draftOrder? }`
  - `RoundPatch` += `startDate?; endDate?; poolFilter?: PoolFilter | null`; `LeaguePatch` += `followsSyncedAt?: string`; `NewLeague` += `format?: LeagueFormat`
  - `poolFilterSchema`, `type PoolFilter`, `DEFAULT_POOL_FILTER` (`lib/season/poolFilter.ts`)
  - `AdminRoundSummary` += `kind: RoundKind; autoAdded: boolean; seasonYear: number | null`, `eventKey: string | null`; `AdminRoundDetail.round` += `kind`, `seasonYear`, `poolFilter`, `eventKey: string | null`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0005_formats.sql`:

```sql
-- 0005_formats.sql — SP2 league formats (spec §5.1–§5.4, §8.2).
-- Additive: every new NOT NULL column has a default, so the SP3 deploy keeps working during this deploy.

-- §5.1 league format (fixed at creation) + follow-a-team sync stamp
alter table leagues
  add column format             text not null default 'event' check (format in ('event', 'season')),
  add column follows_synced_at  timestamptz;

-- §5.2 round kinds
alter table rounds
  add column kind         text not null default 'tba' check (kind in ('tba', 'manual', 'season')),
  alter column event_key  drop not null,
  add column season_year  integer check (season_year between 1992 and 2100),
  add column pool_filter  jsonb,                  -- season rounds only (§5.5)
  add column auto_added   boolean not null default false,
  add constraint rounds_kind_event_key check ((kind = 'tba') = (event_key is not null)),
  add constraint rounds_kind_season    check ((kind = 'season') = (season_year is not null));

-- v1's inline check (0001_init.sql:28) got Postgres's auto-generated name rounds_roster_size_check.
-- Before applying to production, confirm the name:
--   select conname from pg_constraint where conrelid = 'rounds'::regclass and contype = 'c';
alter table rounds drop constraint if exists rounds_roster_size_check;
alter table rounds add constraint rounds_roster_size_check check (roster_size between 1 and 15);

-- §5.3 manual results
create table manual_results (
  round_id        uuid not null references rounds(id) on delete cascade,
  team_key        text not null check (team_key ~ '^frc[1-9][0-9]{0,4}[A-Z]?$'),
  qual_wins       integer not null default 0 check (qual_wins between 0 and 50),
  qual_losses     integer not null default 0 check (qual_losses between 0 and 50),
  qual_ties       integer not null default 0 check (qual_ties between 0 and 50),
  ranking_points  integer check (ranking_points between 0 and 500),     -- null = unknown
  qual_rank       integer check (qual_rank between 1 and 200),          -- null = unknown
  alliance_role   text check (alliance_role in ('captain', 'pick1', 'pick2', 'pick3', 'backup')),
  playoff_wins    integer not null default 0 check (playoff_wins between 0 and 20),
  event_result    text check (event_result in ('winner', 'finalist')),
  award_types     integer[] not null default '{}',                      -- TBA award type ids
  primary key (round_id, team_key)
);

-- §5.4 follow-a-team
create table league_follows (
  league_id    uuid not null references leagues(id) on delete cascade,
  team_number  integer not null check (team_number between 1 and 99999),
  primary key (league_id, team_number)
);
create table league_skipped_events (
  league_id  uuid not null references leagues(id) on delete cascade,
  event_key  text not null,
  primary key (league_id, event_key)
);

-- Global rule: RLS on, no policies, for every table.
alter table manual_results         enable row level security;
alter table league_follows         enable row level security;
alter table league_skipped_events  enable row level security;
```

- [ ] **Step 2: Write a guard test for the migration text**

Create `tests/db/migration0005.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '0005_formats.sql'), 'utf8');

describe('0005_formats.sql', () => {
  it('turns RLS on for every table it creates', () => {
    const created = [...sql.matchAll(/create table (\w+)/g)].map((m) => m[1]);
    expect(created).toEqual(['manual_results', 'league_follows', 'league_skipped_events']);
    for (const table of created) {
      expect(sql, table).toMatch(new RegExp(`alter table ${table}\\s+enable row level security`));
    }
  });

  it('drops the v1 roster check safely before widening it to 15', () => {
    expect(sql).toContain('drop constraint if exists rounds_roster_size_check');
    expect(sql).toContain('check (roster_size between 1 and 15)');
  });

  it('only adds NOT NULL columns that have defaults', () => {
    for (const m of sql.matchAll(/add column (\w+)\s+([^,;]+)/g)) {
      if (/not null/.test(m[2])) expect(m[2], m[1]).toMatch(/default/);
    }
  });
});
```

- [ ] **Step 3: Run it to make sure it passes** (it's a text check, so it passes as soon as the file exists)

Run: `npx vitest run tests/db/migration0005.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 4: Add the pool filter schema** (needed by the `RoundRow` type; its logic is used from Task 11)

Create `lib/season/poolFilter.ts`:

```ts
import { z } from 'zod';

const place = (what: string) =>
  z
    .string(`${what} is required`)
    .trim()
    .min(1, `${what} is required`)
    .max(60, `${what} must be 60 characters or fewer`);

/** Which teams a season round can draft (spec §5.5). Stored as jsonb in rounds.pool_filter. */
export const poolFilterSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('all') }),
  z.strictObject({
    type: z.literal('district'),
    key: z.string('District is required').regex(/^[0-9]{4}[a-z0-9]+$/, 'District keys look like 2027fma'),
  }),
  z.strictObject({ type: z.literal('state'), country: place('Country'), state: place('State') }),
  z.strictObject({ type: z.literal('country'), country: place('Country') }),
]);

export type PoolFilter = z.infer<typeof poolFilterSchema>;

export const DEFAULT_POOL_FILTER: PoolFilter = { type: 'all' };
```

- [ ] **Step 5: Write the failing repo test**

Create `tests/db/formatsRepo.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { UniqueViolation, type Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;

const base = {
  eventName: 'x',
  startDate: '2026-10-24',
  endDate: '2026-10-24',
  timezone: 'America/New_York',
  scoring: defaultScoring(),
};

beforeEach(async () => {
  repo = createMemoryRepo();
  ({ league } = await seedLeague(repo));
});

describe('league format', () => {
  it('defaults to event and has never synced follows', () => {
    expect(league.format).toBe('event');
    expect(league.followsSyncedAt).toBeNull();
  });

  it('stores followsSyncedAt', async () => {
    const saved = await repo.updateLeague(league.id, { followsSyncedAt: '2026-10-01T10:00:00.000Z' });
    expect(saved.followsSyncedAt).toBe('2026-10-01T10:00:00.000Z');
  });
});

describe('round kinds', () => {
  it('a v1-style round is a tba round with no season fields', async () => {
    const round = await repo.createRound({ leagueId: league.id, eventKey: '2025parr', ...base });
    expect(round).toMatchObject({ kind: 'tba', eventKey: '2025parr', seasonYear: null, poolFilter: null, autoAdded: false });
  });

  it('two manual rounds (null event key) never collide', async () => {
    await repo.createRound({ leagueId: league.id, eventKey: null, kind: 'manual', ...base });
    const second = await repo.createRound({ leagueId: league.id, eventKey: null, kind: 'manual', ...base });
    expect(second.kind).toBe('manual');
    expect(await repo.listRounds(league.id)).toHaveLength(2);
  });

  it('a season round keeps its year, pool filter, roster size and order', async () => {
    const round = await repo.createRound({
      leagueId: league.id,
      eventKey: null,
      kind: 'season',
      seasonYear: 2027,
      poolFilter: { type: 'district', key: '2027fma' },
      rosterSize: 8,
      draftOrder: [],
      ...base,
    });
    expect(round).toMatchObject({ kind: 'season', seasonYear: 2027, rosterSize: 8, poolFilter: { type: 'district', key: '2027fma' } });
  });

  it('still rejects the same TBA event twice in one league', async () => {
    await repo.createRound({ leagueId: league.id, eventKey: '2025parr', ...base });
    await expect(repo.createRound({ leagueId: league.id, eventKey: '2025parr', ...base })).rejects.toBeInstanceOf(
      UniqueViolation,
    );
  });

  it('patches dates and pool filter', async () => {
    const round = await repo.createRound({ leagueId: league.id, eventKey: null, kind: 'season', seasonYear: 2027, ...base });
    const saved = await repo.updateRound(round.id, {
      startDate: '2027-02-26',
      endDate: '2027-04-18',
      poolFilter: { type: 'country', country: 'Canada' },
    });
    expect(saved).toMatchObject({ startDate: '2027-02-26', endDate: '2027-04-18', poolFilter: { type: 'country', country: 'Canada' } });
  });
});
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `npx vitest run tests/db/formatsRepo.test.ts`
Expected: FAIL — `league.format` is `undefined`, and TypeScript-level fields like `kind` are missing on created rounds.

- [ ] **Step 7: Update the row types**

In `lib/db/types.ts`, add at the top (after the existing imports):

```ts
import type { PoolFilter } from '@/lib/season/poolFilter';

export type LeagueFormat = 'event' | 'season';
export type RoundKind = 'tba' | 'manual' | 'season';
```

Add to `LeagueRow` (keep every SP1 field):

```ts
  format: LeagueFormat;
  /** Last successful follow-a-team sync (spec §5.4). null = never. */
  followsSyncedAt: string | null;
```

In `RoundRow`, change `eventKey: string;` to `eventKey: string | null;` and add (keep every SP4 field):

```ts
  kind: RoundKind;
  /** Season rounds only. */
  seasonYear: number | null;
  /** Season rounds only; null means "all teams". */
  poolFilter: PoolFilter | null;
  /** Created by follow-a-team (spec §5.4). */
  autoAdded: boolean;
```

- [ ] **Step 8: Update the repo input types**

In `lib/db/repo.ts`, add `import type { LeagueFormat, RoundKind } from '@/lib/db/types';` (merge with the existing type import) and `import type { PoolFilter } from '@/lib/season/poolFilter';`. Then:

- In `NewLeague` add `format?: LeagueFormat;` (default `'event'`).
- In `LeaguePatch` add `followsSyncedAt?: string;`.
- Replace `NewRound` with:

```ts
export type NewRound = {
  leagueId: string;
  /** null for manual and season rounds. */
  eventKey: string | null;
  eventName: string;
  startDate: string;
  endDate: string;
  timezone: string;
  scoring: ScoringConfig;
  kind?: RoundKind; // default 'tba'
  seasonYear?: number | null;
  poolFilter?: PoolFilter | null;
  autoAdded?: boolean;
  rosterSize?: number; // default 4
  draftOrder?: string[]; // default []
};
```

- In `RoundPatch` add `startDate?: string; endDate?: string; poolFilter?: PoolFilter | null;`.

- [ ] **Step 9: Update the in-memory repo**

In `tests/helpers/memoryRepo.ts`:

`createLeague` — add the two defaults in front of the spread (keep SP1's defaults):

```ts
      const row: LeagueRow = {
        id: randomUUID(),
        // …SP1 defaults stay here…
        format: 'event',
        followsSyncedAt: null,
        createdAt: stamp(),
        ...defined(copy(input)),
      } as LeagueRow;
```

`createRound` — the unique rule only applies to TBA rounds, and `defined()` stops an explicit `undefined` in the input from wiping a default:

```ts
    async createRound(input) {
      if (
        input.eventKey !== null &&
        rounds.some((r) => r.leagueId === input.leagueId && r.eventKey === input.eventKey)
      ) {
        throw new UniqueViolation('rounds_league_event_key');
      }
      const row: RoundRow = {
        id: randomUUID(),
        rosterSize: 4,
        draftOrder: [],
        finalizedAt: null,
        kind: 'tba',
        seasonYear: null,
        poolFilter: null,
        autoAdded: false,
        // …SP4's draft defaults (draftMode, pickSeconds, …) stay here…
        createdAt: stamp(),
        ...defined(copy(input)),
      } as RoundRow;
      rounds.push(row);
      return copy(row);
    },
```

(`updateLeague` / `updateRound` already use `defined(copy(patch))`, so the new patch fields work without changes.)

- [ ] **Step 10: Update the Supabase repo**

In `lib/db/supabaseRepo.ts`:

`toLeague` add:

```ts
  format: r.format ?? 'event',
  followsSyncedAt: r.follows_synced_at ?? null,
```

`toRound` add:

```ts
  kind: r.kind ?? 'tba',
  seasonYear: r.season_year ?? null,
  poolFilter: r.pool_filter ?? null,
  autoAdded: r.auto_added ?? false,
```

`createLeague` insert object add `format: input.format,` (undefined is dropped by supabase-js, so the column default applies).

`updateLeague` `defined({...})` add `follows_synced_at: patch.followsSyncedAt,`.

`createRound` insert object becomes:

```ts
          .insert(
            defined({
              league_id: input.leagueId,
              event_key: input.eventKey,
              event_name: input.eventName,
              start_date: input.startDate,
              end_date: input.endDate,
              timezone: input.timezone,
              scoring: input.scoring,
              kind: input.kind,
              season_year: input.seasonYear,
              pool_filter: input.poolFilter,
              auto_added: input.autoAdded,
              roster_size: input.rosterSize,
              draft_order: input.draftOrder,
            }),
          )
```

`updateRound` `defined({...})` add:

```ts
              start_date: patch.startDate,
              end_date: patch.endDate,
              pool_filter: patch.poolFilter,
```

- [ ] **Step 11: Run the repo test**

Run: `npx vitest run tests/db/formatsRepo.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 12: Fix the nullable `eventKey` fallout**

Run: `npm run typecheck`. Every error is a place that assumed every round has a TBA event. Fix each one with the rule **"TBA-only code runs only when `round.kind === 'tba' && round.eventKey`"**. The v1 places (SP1/SP3/SP4 code may add a few more — apply the same rule):

`lib/rounds/pool.ts` — temporary guard (Task 5 replaces this function):

```ts
  const tba = round.eventKey
    ? await getTba<TeamSimple[]>(`/event/${round.eventKey}/teams/simple`, { windowMs: cacheWindowFor(round, now) })
    : { data: null, fetchedAt: null, stale: false };
```

(restructure the `Promise.all` into two awaits if needed; behavior for TBA rounds must not change).

`lib/views/round.ts` — wherever the TBA scoring call is (SP3 made it `getEventScores(round.eventKey, …)`), guard it the same way and fall back to the existing "no event data" path when `eventKey` is null. Task 5 replaces this with `scoreSourceFor`.

`lib/api/types.ts` — `AdminRoundSummary.eventKey: string | null` and add `kind: RoundKind; autoAdded: boolean; seasonYear: number | null;`. In `AdminRoundDetail.round`: `eventKey: string | null` and add `kind: RoundKind; seasonYear: number | null; poolFilter: PoolFilter | null;` (import both types).

`lib/rounds/detail.ts` — in the `round:` object add `kind: round.kind, seasonYear: round.seasonYear, poolFilter: round.poolFilter,`.

`app/api/l/[slug]/admin/state/route.ts` — in each round summary add `kind: r.kind, autoAdded: r.autoAdded, seasonYear: r.seasonYear,`.

`app/l/[slug]/r/[roundId]/page.tsx` — render the "View on The Blue Alliance" `Button` only when `round.eventKey` is set:

```tsx
        {round.eventKey ? (
          <Button href={tbaEventUrl(round.eventKey)} variant="secondary" size="sm" target="_blank" rel="noopener noreferrer">
            View on The Blue Alliance
            <ExternalLink className="size-4 shrink-0" />
          </Button>
        ) : null}
```

`components/admin/AdminDashboard.tsx` — the round row's second line:

```tsx
                    round.eventKey ?? (round.kind === 'manual' ? 'Manual event' : `${round.seasonYear} season`),
```

`app/api/l/[slug]/admin/rounds/[id]/refresh/route.ts` — right after `requireRound`:

```ts
    if (round.kind !== 'tba' || !round.eventKey) {
      throw new HttpError(409, 'Only rounds for a TBA event can be refreshed');
    }
```

(import `HttpError` from `@/lib/api/http`).

- [ ] **Step 13: Pin the refresh rule with a test**

In `tests/api/refresh.test.ts` add:

```ts
  it('answers 409 for a manual round (nothing to refresh)', async () => {
    const manual = await repo.createRound({
      leagueId: league.id, eventKey: null, kind: 'manual', eventName: 'Garage Games',
      startDate: '2026-11-07', endDate: '2026-11-07', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    const res = await refresh(request('POST', '/x'), params({ slug: league.slug, id: manual.id }));
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('Only rounds for a TBA event can be refreshed');
  });
```

(use the file's existing names for the imported handler, session setup and `league`; SP1 already switched this file to sessions.)

- [ ] **Step 14: Run the gates**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass (previous count + 11).

- [ ] **Step 15: Commit**

```bash
git add supabase/migrations/0005_formats.sql lib/season/poolFilter.ts lib/db lib/rounds lib/views/round.ts lib/api/types.ts \
  "app/api/l/[slug]/admin/state/route.ts" "app/api/l/[slug]/admin/rounds/[id]/refresh/route.ts" \
  "app/l/[slug]/r/[roundId]/page.tsx" components/admin/AdminDashboard.tsx tests
git commit -m "feat(sp2): migration 0005 and round kinds / league format in the repos

Co-Authored-By: <the session's attribution line>"
```

---

### Task 2: Repo methods for manual results, follows, skipped events, idempotent round creation

**Files:**
- Modify: `lib/scoring/types.ts` (the `ManualResult` type), `lib/db/types.ts`, `lib/db/repo.ts`, `lib/db/supabaseRepo.ts`, `tests/helpers/memoryRepo.ts`
- Test: `tests/db/formatsRepo.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - `type AllianceRole = 'captain' | 'pick1' | 'pick2' | 'pick3' | 'backup'` and `type ManualResult = { teamKey: string; qualWins: number; qualLosses: number; qualTies: number; rankingPoints: number | null; qualRank: number | null; allianceRole: AllianceRole | null; playoffWins: number; eventResult: 'winner' | 'finalist' | null; awardTypes: number[] }` (`lib/scoring/types.ts`)
  - `type ManualResultRow = ManualResult & { roundId: string }` (`lib/db/types.ts`)
  - Repo: `listManualResults(roundId): Promise<ManualResultRow[]>` (by team key), `upsertManualResult(row: ManualResultRow): Promise<ManualResultRow>`, `deleteManualResult(roundId, teamKey): Promise<void>`, `listFollows(leagueId): Promise<number[]>` (ascending), `setFollows(leagueId, teamNumbers: number[]): Promise<void>` (replaces), `listLeaguesWithFollows(): Promise<LeagueRow[]>`, `listSkippedEvents(leagueId): Promise<string[]>`, `addSkippedEvent(leagueId, eventKey): Promise<void>` (idempotent), `createRoundIfAbsent(input: NewRound): Promise<RoundRow | null>` (null = that event is already a round in the league), `listOpenSeasonRounds(): Promise<RoundRow[]>` (all leagues, `kind = 'season'`, not finalized)

- [ ] **Step 1: Write the failing tests**

Append to `tests/db/formatsRepo.test.ts`:

```ts
import type { ManualResultRow } from '@/lib/db/types';

const result = (roundId: string, teamKey: string, over: Partial<ManualResultRow> = {}): ManualResultRow => ({
  roundId,
  teamKey,
  qualWins: 0,
  qualLosses: 0,
  qualTies: 0,
  rankingPoints: null,
  qualRank: null,
  allianceRole: null,
  playoffWins: 0,
  eventResult: null,
  awardTypes: [],
  ...over,
});

describe('manual results', () => {
  it('upserts, lists by team key, and deletes', async () => {
    const round = await repo.createRound({ leagueId: league.id, eventKey: null, kind: 'manual', ...base });
    await repo.upsertManualResult(result(round.id, 'frc5181', { qualWins: 3 }));
    await repo.upsertManualResult(result(round.id, 'frc341', { qualRank: 1 }));
    await repo.upsertManualResult(result(round.id, 'frc5181', { qualWins: 4, awardTypes: [0] }));
    const rows = await repo.listManualResults(round.id);
    expect(rows.map((r) => r.teamKey)).toEqual(['frc341', 'frc5181']);
    expect(rows[1]).toMatchObject({ qualWins: 4, awardTypes: [0] });
    await repo.deleteManualResult(round.id, 'frc341');
    expect((await repo.listManualResults(round.id)).map((r) => r.teamKey)).toEqual(['frc5181']);
  });

  it('go away with their round', async () => {
    const round = await repo.createRound({ leagueId: league.id, eventKey: null, kind: 'manual', ...base });
    await repo.upsertManualResult(result(round.id, 'frc5181'));
    await repo.deleteRound(round.id);
    expect(await repo.listManualResults(round.id)).toEqual([]);
  });
});

describe('follows and skipped events', () => {
  it('replaces the follow list and finds leagues that follow someone', async () => {
    await repo.setFollows(league.id, [5181, 341]);
    expect(await repo.listFollows(league.id)).toEqual([341, 5181]);
    expect((await repo.listLeaguesWithFollows()).map((l) => l.id)).toEqual([league.id]);
    await repo.setFollows(league.id, []);
    expect(await repo.listLeaguesWithFollows()).toEqual([]);
  });

  it('adds a skipped event once, however often it is added', async () => {
    await repo.addSkippedEvent(league.id, '2026paca');
    await repo.addSkippedEvent(league.id, '2026paca');
    expect(await repo.listSkippedEvents(league.id)).toEqual(['2026paca']);
  });
});

describe('createRoundIfAbsent (spec §5.4 "on conflict do nothing")', () => {
  it('creates the first time and returns null the second time, without throwing', async () => {
    const input = { leagueId: league.id, eventKey: '2026paca', autoAdded: true, ...base };
    const first = await repo.createRoundIfAbsent(input);
    expect(first?.autoAdded).toBe(true);
    expect(await repo.createRoundIfAbsent(input)).toBeNull();
    expect(await repo.listRounds(league.id)).toHaveLength(1);
  });

  it('two at the same moment still make one round (Review Focus 2)', async () => {
    const input = { leagueId: league.id, eventKey: '2026paca', autoAdded: true, ...base };
    const out = await Promise.all([repo.createRoundIfAbsent(input), repo.createRoundIfAbsent(input)]);
    expect(out.filter((r) => r !== null)).toHaveLength(1);
    expect(await repo.listRounds(league.id)).toHaveLength(1);
  });
});

describe('listOpenSeasonRounds', () => {
  it('returns unfinalized season rounds from every league', async () => {
    const season = await repo.createRound({ leagueId: league.id, eventKey: null, kind: 'season', seasonYear: 2027, ...base });
    const done = await repo.createRound({ leagueId: league.id, eventKey: null, kind: 'season', seasonYear: 2026, ...base });
    await repo.updateRound(done.id, { finalizedAt: '2026-05-01T00:00:00.000Z' });
    await repo.createRound({ leagueId: league.id, eventKey: '2025parr', ...base });
    expect((await repo.listOpenSeasonRounds()).map((r) => r.id)).toEqual([season.id]);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/db/formatsRepo.test.ts`
Expected: FAIL — `repo.upsertManualResult is not a function` (and the other new methods).

- [ ] **Step 3: Add the types**

In `lib/scoring/types.ts` append:

```ts
export type AllianceRole = 'captain' | 'pick1' | 'pick2' | 'pick3' | 'backup';

/** One team's typed-in results for a manual round (spec §5.3). null = unknown. */
export type ManualResult = {
  teamKey: string;
  qualWins: number;
  qualLosses: number;
  qualTies: number;
  rankingPoints: number | null;
  qualRank: number | null;
  allianceRole: AllianceRole | null;
  playoffWins: number;
  eventResult: 'winner' | 'finalist' | null;
  /** TBA award type ids. */
  awardTypes: number[];
};
```

In `lib/db/types.ts` append:

```ts
import type { ManualResult } from '@/lib/scoring/types';

export type ManualResultRow = ManualResult & { roundId: string };
```

(put the import with the others at the top of the file).

- [ ] **Step 4: Add the methods to the `Repo` interface**

In `lib/db/repo.ts`, add `ManualResultRow` to the type import and add to `interface Repo`:

```ts
  /** Idempotent insert for follow-a-team (spec §5.4): null when the league already has that event. */
  createRoundIfAbsent(input: NewRound): Promise<RoundRow | null>;
  /** kind = 'season' and not finalized, across every league (daily cron). */
  listOpenSeasonRounds(): Promise<RoundRow[]>;

  listManualResults(roundId: string): Promise<ManualResultRow[]>; // by team key
  upsertManualResult(row: ManualResultRow): Promise<ManualResultRow>;
  deleteManualResult(roundId: string, teamKey: string): Promise<void>;

  listFollows(leagueId: string): Promise<number[]>; // ascending
  setFollows(leagueId: string, teamNumbers: number[]): Promise<void>; // replaces the whole list
  listLeaguesWithFollows(): Promise<LeagueRow[]>;
  listSkippedEvents(leagueId: string): Promise<string[]>;
  addSkippedEvent(leagueId: string, eventKey: string): Promise<void>; // adding twice is fine
```

- [ ] **Step 5: Implement them in the in-memory repo**

In `tests/helpers/memoryRepo.ts`, add state next to the other arrays:

```ts
  let manualResults: ManualResultRow[] = [];
  let follows: { leagueId: string; teamNumber: number }[] = [];
  let skipped: { leagueId: string; eventKey: string }[] = [];
```

In `dropRounds(ids)` add `manualResults = manualResults.filter((m) => !ids.includes(m.roundId));`. In `deleteLeague(id)` add:

```ts
      follows = follows.filter((f) => f.leagueId !== id);
      skipped = skipped.filter((s) => s.leagueId !== id);
```

Add the methods to the returned object:

```ts
    async createRoundIfAbsent(input) {
      if (rounds.some((r) => r.leagueId === input.leagueId && r.eventKey !== null && r.eventKey === input.eventKey)) {
        return null;
      }
      return this.createRound(input);
    },
    async listOpenSeasonRounds() {
      return copy(rounds.filter((r) => r.kind === 'season' && r.finalizedAt === null));
    },

    async listManualResults(roundId) {
      return copy(
        manualResults.filter((m) => m.roundId === roundId).sort((a, b) => a.teamKey.localeCompare(b.teamKey)),
      );
    },
    async upsertManualResult(row) {
      manualResults = manualResults.filter((m) => !(m.roundId === row.roundId && m.teamKey === row.teamKey));
      manualResults.push(copy(row));
      return copy(row);
    },
    async deleteManualResult(roundId, teamKey) {
      manualResults = manualResults.filter((m) => !(m.roundId === roundId && m.teamKey === teamKey));
    },

    async listFollows(leagueId) {
      return follows.filter((f) => f.leagueId === leagueId).map((f) => f.teamNumber).sort((a, b) => a - b);
    },
    async setFollows(leagueId, teamNumbers) {
      follows = follows.filter((f) => f.leagueId !== leagueId);
      for (const teamNumber of new Set(teamNumbers)) follows.push({ leagueId, teamNumber });
    },
    async listLeaguesWithFollows() {
      const ids = new Set(follows.map((f) => f.leagueId));
      return copy(leagues.filter((l) => ids.has(l.id)));
    },
    async listSkippedEvents(leagueId) {
      return skipped.filter((s) => s.leagueId === leagueId).map((s) => s.eventKey);
    },
    async addSkippedEvent(leagueId, eventKey) {
      if (!skipped.some((s) => s.leagueId === leagueId && s.eventKey === eventKey)) skipped.push({ leagueId, eventKey });
    },
```

`createRoundIfAbsent` calls `this.createRound`, so the returned object literal must use method syntax (it already does). Because the memory repo is synchronous inside each `async` body, the check-then-insert can't interleave — the concurrency test in Step 1 passes for the same reason the real `on conflict do nothing` does.

- [ ] **Step 6: Implement them in the Supabase repo**

In `lib/db/supabaseRepo.ts` add a mapper next to the others:

```ts
const toManualResult = (r: Raw): ManualResultRow => ({
  roundId: r.round_id,
  teamKey: r.team_key,
  qualWins: r.qual_wins,
  qualLosses: r.qual_losses,
  qualTies: r.qual_ties,
  rankingPoints: r.ranking_points,
  qualRank: r.qual_rank,
  allianceRole: r.alliance_role,
  playoffWins: r.playoff_wins,
  eventResult: r.event_result,
  awardTypes: r.award_types ?? [],
});
```

Pull the insert object of `createRound` into a helper so both creators share it:

```ts
function roundInsert(input: NewRound): Raw {
  return defined({
    league_id: input.leagueId,
    event_key: input.eventKey,
    event_name: input.eventName,
    start_date: input.startDate,
    end_date: input.endDate,
    timezone: input.timezone,
    scoring: input.scoring,
    kind: input.kind,
    season_year: input.seasonYear,
    pool_filter: input.poolFilter,
    auto_added: input.autoAdded,
    roster_size: input.rosterSize,
    draft_order: input.draftOrder,
  });
}
```

(`createRound` becomes `run(db.from('rounds').insert(roundInsert(input)).select())`; import `NewRound` from `@/lib/db/repo`.) Then add:

```ts
    async createRoundIfAbsent(input) {
      // ON CONFLICT (league_id, event_key) DO NOTHING: a conflicting row comes back as an empty result.
      const rows = await run(
        db
          .from('rounds')
          .upsert(roundInsert(input), { onConflict: 'league_id,event_key', ignoreDuplicates: true })
          .select(),
      );
      return rows[0] ? toRound(rows[0]) : null;
    },
    async listOpenSeasonRounds() {
      const rows = await run(db.from('rounds').select().eq('kind', 'season').is('finalized_at', null));
      return rows.map(toRound);
    },

    async listManualResults(roundId) {
      const rows = await run(db.from('manual_results').select().eq('round_id', roundId).order('team_key'));
      return rows.map(toManualResult);
    },
    async upsertManualResult(row) {
      const rows = await run(
        db
          .from('manual_results')
          .upsert(
            {
              round_id: row.roundId,
              team_key: row.teamKey,
              qual_wins: row.qualWins,
              qual_losses: row.qualLosses,
              qual_ties: row.qualTies,
              ranking_points: row.rankingPoints,
              qual_rank: row.qualRank,
              alliance_role: row.allianceRole,
              playoff_wins: row.playoffWins,
              event_result: row.eventResult,
              award_types: row.awardTypes,
            },
            { onConflict: 'round_id,team_key' },
          )
          .select(),
      );
      return first(rows, toManualResult, 'manual result');
    },
    async deleteManualResult(roundId, teamKey) {
      await run(db.from('manual_results').delete().eq('round_id', roundId).eq('team_key', teamKey));
    },

    async listFollows(leagueId) {
      const rows = await run(db.from('league_follows').select('team_number').eq('league_id', leagueId).order('team_number'));
      return rows.map((r) => r.team_number as number);
    },
    async setFollows(leagueId, teamNumbers) {
      // Two statements, not a transaction: a crash in between leaves no follows, which is safe (sync adds nothing).
      await run(db.from('league_follows').delete().eq('league_id', leagueId));
      const unique = [...new Set(teamNumbers)];
      if (unique.length > 0) {
        await run(db.from('league_follows').insert(unique.map((n) => ({ league_id: leagueId, team_number: n }))));
      }
    },
    async listLeaguesWithFollows() {
      // The !inner embed keeps only leagues with at least one follow; one row per league.
      const rows = await run(db.from('leagues').select('*, league_follows!inner(team_number)'));
      return rows.map(toLeague);
    },
    async listSkippedEvents(leagueId) {
      const rows = await run(db.from('league_skipped_events').select('event_key').eq('league_id', leagueId));
      return rows.map((r) => r.event_key as string);
    },
    async addSkippedEvent(leagueId, eventKey) {
      await run(
        db
          .from('league_skipped_events')
          .upsert({ league_id: leagueId, event_key: eventKey }, { onConflict: 'league_id,event_key', ignoreDuplicates: true }),
      );
    },
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/db/formatsRepo.test.ts`
Expected: PASS (15 tests)

- [ ] **Step 8: Run the gates**

Run: `npm run typecheck && npm test`
Expected: clean, all pass.

- [ ] **Step 9: Commit**

```bash
git add lib/scoring/types.ts lib/db tests/helpers/memoryRepo.ts tests/db/formatsRepo.test.ts
git commit -m "feat(sp2): repo methods for manual results, follows, skipped events, idempotent rounds

Co-Authored-By: <the session's attribution line>"
```

---

### Task 3: `scoreManualEvent` — score typed-in results like `scoreEvent` does

**Files:**
- Modify: `lib/scoring/types.ts` (`RpMethod` gains `'manual'`)
- Create: `lib/scoring/awardTypes.ts`, `lib/scoring/manual.ts`
- Test: `tests/scoring/manual.test.ts`

**Interfaces:**
- Consumes: `ManualResult`, `AllianceRole` (Task 2); v1 `rankTierPoints` (`lib/scoring/quals.ts`), `awardLines` (`lib/scoring/bonus.ts`).
- Produces:
  - `RpMethod = 'extra_stats' | 'sort_order_avg' | 'none' | 'manual'`
  - `AWARD_CHOICES: { type: number; name: string }[]`, `OTHER_AWARD_TYPE = 70`, `awardName(type: number): string` (`lib/scoring/awardTypes.ts`)
  - `ALLIANCE_ROLE_LABEL: Record<AllianceRole, string>`, `scoreManualEvent(results: ManualResult[], config: ScoringConfig): EventScores` (`lib/scoring/manual.ts`)

- [ ] **Step 1: Write the failing tests**

Create `tests/scoring/manual.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { OTHER_AWARD_TYPE, awardName } from '@/lib/scoring/awardTypes';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { scoreManualEvent } from '@/lib/scoring/manual';
import type { ManualResult } from '@/lib/scoring/types';

const blank = (teamKey: string, over: Partial<ManualResult> = {}): ManualResult => ({
  teamKey,
  qualWins: 0,
  qualLosses: 0,
  qualTies: 0,
  rankingPoints: null,
  qualRank: null,
  allianceRole: null,
  playoffWins: 0,
  eventResult: null,
  awardTypes: [],
  ...over,
});

describe('scoreManualEvent', () => {
  it('emits the same categories, labels and points as scoreEvent for a full result', () => {
    const out = scoreManualEvent(
      [
        blank('frc5181', {
          qualWins: 7, qualLosses: 2, qualTies: 1, rankingPoints: 24, qualRank: 3,
          allianceRole: 'captain', playoffWins: 5, eventResult: 'winner', awardTypes: [0],
        }),
      ],
      DEFAULT_SCORING,
    );
    expect(out.teams.get('frc5181')!.lines).toEqual([
      { category: 'qualRecord', label: 'Qual record 7-2-1', points: 7 * 3 + 1 * 1 },
      { category: 'rankingPoints', label: 'Ranking points 24', quantity: 24, points: 24 },
      { category: 'rank', label: 'Final rank #3', quantity: 3, points: 5 },
      { category: 'alliance', label: 'Alliance captain', points: 8 },
      { category: 'playoffWins', label: 'Playoff wins ×5', quantity: 5, points: 20 },
      { category: 'eventResult', label: 'Event winner', points: 15 },
      { category: 'awards', label: 'Impact Award', points: 10 },
    ]);
    expect(out.teams.get('frc5181')!.total).toBe(22 + 24 + 5 + 8 + 20 + 15 + 10);
  });

  it('emits no line for unknown RP or rank, no alliance, no playoff wins, no result', () => {
    const lines = scoreManualEvent([blank('frc341', { qualWins: 1 })], DEFAULT_SCORING).teams.get('frc341')!.lines;
    expect(lines.map((l) => l.category)).toEqual(['qualRecord']);
  });

  it('labels every alliance role the way scoreEvent does', () => {
    const roles = ['captain', 'pick1', 'pick2', 'pick3', 'backup'] as const;
    const out = scoreManualEvent(
      roles.map((allianceRole, i) => blank(`frc${i + 1}`, { allianceRole })),
      DEFAULT_SCORING,
    );
    expect(roles.map((_, i) => out.teams.get(`frc${i + 1}`)!.lines[1])).toEqual([
      { category: 'alliance', label: 'Alliance captain', points: 8 },
      { category: 'alliance', label: 'Alliance first pick', points: 6 },
      { category: 'alliance', label: 'Alliance second pick', points: 3 },
      { category: 'alliance', label: 'Alliance third pick', points: 2 },
      { category: 'alliance', label: 'Backup robot', points: 2 },
    ]);
  });

  it('scores finalists', () => {
    const lines = scoreManualEvent([blank('frc1', { eventResult: 'finalist' })], DEFAULT_SCORING).teams.get('frc1')!.lines;
    expect(lines).toContainEqual({ category: 'eventResult', label: 'Event finalist', points: 8 });
  });

  it('applies the config award rules: excluded types score nothing, unknown types use the default', () => {
    // 1 = Winner (excluded in the default config), 70 = Other (not in byType → default 5)
    const lines = scoreManualEvent([blank('frc1', { awardTypes: [1, OTHER_AWARD_TYPE] })], DEFAULT_SCORING).teams.get(
      'frc1',
    )!.lines;
    expect(lines.filter((l) => l.category === 'awards')).toEqual([
      { category: 'awards', label: 'Other award', points: 5 },
    ]);
  });

  it('never emits an OPR bonus', () => {
    const out = scoreManualEvent([blank('frc1', { qualRank: 1, qualWins: 10 })], DEFAULT_SCORING);
    expect(out.teams.get('frc1')!.lines.some((l) => l.category === 'oprBonus')).toBe(false);
  });

  it('reports rpMethod manual and qualsComplete only once there are results', () => {
    expect(scoreManualEvent([], DEFAULT_SCORING)).toEqual({ teams: new Map(), qualsComplete: false, rpMethod: 'manual' });
    expect(scoreManualEvent([blank('frc1')], DEFAULT_SCORING).qualsComplete).toBe(true);
  });
});

describe('awardName', () => {
  it('names known types and falls back for unknown ones', () => {
    expect(awardName(0)).toBe('Impact Award');
    expect(awardName(9999)).toBe('Award (type 9999)');
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/scoring/manual.test.ts`
Expected: FAIL — `Cannot find module '@/lib/scoring/manual'`.

- [ ] **Step 3: Add `'manual'` to `RpMethod`**

In `lib/scoring/types.ts`:

```ts
export type RpMethod = 'extra_stats' | 'sort_order_avg' | 'none' | 'manual';
```

If SP3's `deserializeEventScores` validates `rpMethod` against a list, add `'manual'` there too (manual rounds are never cached, but the type must stay one union).

- [ ] **Step 4: Write the award list**

Create `lib/scoring/awardTypes.ts`. The ids are TBA's `AwardType` enum values; before committing, check them against TBA's API docs (thebluealliance.com/apidocs → Award → `award_type`) and fix any that differ.

```ts
/** TBA's "Other" award type. The manual Results tab uses it for anything not in the list. */
export const OTHER_AWARD_TYPE = 70;

/**
 * Awards the manual Results tab offers (spec §5.3). Winner (1) and Finalist (2) are left out on
 * purpose: those come from the "Event result" field. Scoring still follows the round's config
 * (byType / excludedTypes / default), exactly as for TBA awards.
 */
export const AWARD_CHOICES: { type: number; name: string }[] = [
  { type: 0, name: 'Impact Award' },
  { type: 9, name: 'Engineering Inspiration Award' },
  { type: 10, name: 'Rookie All Star Award' },
  { type: 15, name: 'Rookie Inspiration Award' },
  { type: 3, name: 'Woodie Flowers Finalist Award' },
  { type: 4, name: "Dean's List Finalist Award" },
  { type: 5, name: 'Volunteer of the Year Award' },
  { type: 11, name: 'Gracious Professionalism Award' },
  { type: 13, name: "Judges' Award" },
  { type: 16, name: 'Industrial Design Award' },
  { type: 17, name: 'Quality Award' },
  { type: 18, name: 'Safety Award' },
  { type: 20, name: 'Creativity Award' },
  { type: 21, name: 'Engineering Excellence Award' },
  { type: 29, name: 'Innovation in Control Award' },
  { type: 71, name: 'Autonomous Award' },
  { type: OTHER_AWARD_TYPE, name: 'Other award' },
];

const NAMES = new Map(AWARD_CHOICES.map((a) => [a.type, a.name]));

export function awardName(type: number): string {
  return NAMES.get(type) ?? `Award (type ${type})`;
}
```

- [ ] **Step 5: Write `scoreManualEvent`**

Create `lib/scoring/manual.ts`:

```ts
import { awardName } from '@/lib/scoring/awardTypes';
import { awardLines } from '@/lib/scoring/bonus';
import type { ScoringConfig } from '@/lib/scoring/config';
import { rankTierPoints } from '@/lib/scoring/quals';
import type { AllianceRole, EventScores, Line, ManualResult, TeamScore } from '@/lib/scoring/types';
import type { Award } from '@/lib/tba/types';

/** Must match the labels in lib/scoring/playoffs.ts allianceLines(), so both kinds of round read the same. */
export const ALLIANCE_ROLE_LABEL: Record<AllianceRole, string> = {
  captain: 'Alliance captain',
  pick1: 'Alliance first pick',
  pick2: 'Alliance second pick',
  pick3: 'Alliance third pick',
  backup: 'Backup robot',
};

/**
 * Pure: typed-in final results + config → the same EventScores shape as scoreEvent (spec §5.3).
 * Same categories and labels, in the same order; never an OPR bonus (there is no OPR without TBA).
 */
export function scoreManualEvent(results: ManualResult[], config: ScoringConfig): EventScores {
  const teams = new Map<string, TeamScore>();
  for (const r of results) {
    const lines: Line[] = [
      {
        category: 'qualRecord',
        label: `Qual record ${r.qualWins}-${r.qualLosses}-${r.qualTies}`,
        points: r.qualWins * config.qualWin + r.qualTies * config.qualTie + r.qualLosses * config.qualLoss,
      },
    ];
    if (r.rankingPoints !== null) {
      lines.push({
        category: 'rankingPoints',
        label: `Ranking points ${r.rankingPoints}`,
        quantity: r.rankingPoints,
        points: r.rankingPoints * config.rankingPoint,
      });
    }
    if (r.qualRank !== null) {
      // A typed-in rank is a final rank: results are entered once quals are over.
      lines.push({
        category: 'rank',
        label: `Final rank #${r.qualRank}`,
        quantity: r.qualRank,
        points: rankTierPoints(r.qualRank, config.rankTiers),
      });
    }
    if (r.allianceRole) {
      lines.push({ category: 'alliance', label: ALLIANCE_ROLE_LABEL[r.allianceRole], points: config.alliance[r.allianceRole] });
    }
    if (r.playoffWins > 0) {
      lines.push({
        category: 'playoffWins',
        label: `Playoff wins ×${r.playoffWins}`,
        quantity: r.playoffWins,
        points: r.playoffWins * config.playoffMatchWin,
      });
    }
    if (r.eventResult === 'winner') lines.push({ category: 'eventResult', label: 'Event winner', points: config.eventWinner });
    if (r.eventResult === 'finalist') {
      lines.push({ category: 'eventResult', label: 'Event finalist', points: config.eventFinalist });
    }
    // Reuse the TBA award rules (excluded types, byType, default) by describing each award like TBA would.
    const awards: Award[] = r.awardTypes.map((type) => ({
      name: awardName(type),
      award_type: type,
      recipient_list: [{ team_key: r.teamKey, awardee: null }],
    }));
    lines.push(...(awardLines(awards, config).get(r.teamKey) ?? []));

    teams.set(r.teamKey, { teamKey: r.teamKey, total: lines.reduce((sum, l) => sum + l.points, 0), lines });
  }
  return { teams, qualsComplete: results.length > 0, rpMethod: 'manual' };
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/scoring/manual.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 7: Run the gates**

Run: `npm run typecheck && npm test`
Expected: clean, all pass. (The round page's `rpMissing` check compares to `'none'`, so `'manual'` never shows "RP data unavailable".)

- [ ] **Step 8: Commit**

```bash
git add lib/scoring/types.ts lib/scoring/awardTypes.ts lib/scoring/manual.ts tests/scoring/manual.test.ts
git commit -m "feat(sp2): scoreManualEvent scores typed-in results like scoreEvent

Co-Authored-By: <the session's attribution line>"
```

---

### Task 4: `2025parr` equivalence test for manual scoring

**Files:**
- Test: `tests/scoring/manual-equivalence.test.ts`

**Interfaces:**
- Consumes: `scoreManualEvent` (Task 3); v1 `scoreEvent`, `qualRecords`, `extractRp`, `allianceLines`, `playoffLines`, `eventResultLines`; `loadFixture('2025parr')`.
- Produces: nothing new — this is the spec §5.3 guarantee that manual rounds score exactly like TBA rounds minus OPR.

- [ ] **Step 1: Write the test**

Create `tests/scoring/manual-equivalence.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING, defaultScoring, type ScoringConfig } from '@/lib/scoring/config';
import { scoreEvent } from '@/lib/scoring/engine';
import { scoreManualEvent } from '@/lib/scoring/manual';
import { allianceLines, eventResultLines, playoffLines } from '@/lib/scoring/playoffs';
import { extractRp, qualRecords } from '@/lib/scoring/quals';
import type { AllianceRole, ManualResult } from '@/lib/scoring/types';
import { loadFixture } from '../helpers/fixture';

const data = loadFixture('2025parr');

const ROLE_BY_LABEL: Record<string, AllianceRole> = {
  'Alliance captain': 'captain',
  'Alliance first pick': 'pick1',
  'Alliance second pick': 'pick2',
  'Alliance third pick': 'pick3',
  'Backup robot': 'backup',
};

/** What a commissioner would type into the Results tab, read off Ramp Riot 2025's real TBA data. */
function typedResults(): ManualResult[] {
  const records = qualRecords(data.rankings, data.matches);
  const rp = extractRp(data.rankings).byTeam;
  const ranks = new Map(
    (data.rankings?.rankings ?? []).filter((r) => r.matches_played > 0).map((r) => [r.team_key, r.rank]),
  );
  const roles = allianceLines(data.alliances, DEFAULT_SCORING);
  const wins = playoffLines(data.matches, DEFAULT_SCORING);
  const finish = eventResultLines(data.alliances, data.matches, DEFAULT_SCORING);
  const awards = new Map<string, number[]>();
  for (const a of data.awards ?? []) {
    for (const r of a.recipient_list) {
      if (r.team_key) awards.set(r.team_key, [...(awards.get(r.team_key) ?? []), a.award_type]);
    }
  }
  return (data.teams ?? []).map((t) => {
    const rec = records.get(t.key) ?? { wins: 0, losses: 0, ties: 0 };
    const role = roles.get(t.key);
    const fin = finish.get(t.key);
    return {
      teamKey: t.key,
      qualWins: rec.wins,
      qualLosses: rec.losses,
      qualTies: rec.ties,
      rankingPoints: rp.get(t.key) ?? null,
      qualRank: ranks.get(t.key) ?? null,
      allianceRole: role ? ROLE_BY_LABEL[role.label] : null,
      playoffWins: wins.get(t.key)?.quantity ?? 0,
      eventResult: fin ? (fin.label === 'Event winner' ? 'winner' : 'finalist') : null,
      awardTypes: awards.get(t.key) ?? [],
    };
  });
}

/** A config where every category is worth a different, unusual amount, so a swapped field can't hide. */
const ODD: ScoringConfig = {
  ...defaultScoring(),
  qualWin: 7,
  qualTie: 3,
  qualLoss: -1,
  rankingPoint: 2,
  alliance: { captain: 11, pick1: 9, pick2: 5, pick3: 4, backup: 1 },
  playoffMatchWin: 6,
  eventWinner: 30,
  eventFinalist: 13,
};

describe.each([
  ['default scoring', DEFAULT_SCORING],
  ['unusual scoring', ODD],
])('manual results for 2025parr with %s', (_name, config) => {
  const tba = scoreEvent(data, config);
  const manual = scoreManualEvent(typedResults(), config);

  it('covers all 34 teams', () => {
    expect(manual.teams.size).toBe(34);
  });

  it('gives every team the TBA total minus its OPR line', () => {
    for (const [teamKey, score] of tba.teams) {
      const opr = score.lines.filter((l) => l.category === 'oprBonus').reduce((s, l) => s + l.points, 0);
      expect(manual.teams.get(teamKey)?.total ?? 0, teamKey).toBe(score.total - opr);
    }
  });

  it('produces the same lines (labels, quantities, order) apart from OPR', () => {
    for (const [teamKey, score] of tba.teams) {
      expect(manual.teams.get(teamKey)?.lines, teamKey).toEqual(score.lines.filter((l) => l.category !== 'oprBonus'));
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/scoring/manual-equivalence.test.ts`
Expected: PASS (6 tests). If a line differs, the failing team key and both line lists are in the output; fix `scoreManualEvent` (never `scoreEvent` — spec §5.3 says it stays unchanged).

- [ ] **Step 3: Commit**

```bash
git add tests/scoring/manual-equivalence.test.ts
git commit -m "test(sp2): 2025parr typed-in results score like TBA minus OPR

Co-Authored-By: <the session's attribution line>"
```

---

### Task 5: Manual rounds — create them, give them a pool, and score them on the round and league pages

**Files:**
- Create: `lib/rounds/scoreSource.ts`
- Modify: `lib/rounds/pool.ts`, `lib/views/round.ts`, `app/api/l/[slug]/admin/rounds/route.ts`, `app/l/[slug]/r/[roundId]/page.tsx`, `tests/helpers/api.ts`
- Test: `tests/api/rounds.test.ts` (append), `tests/rounds/pool.test.ts` (create), `tests/views/manualRound.test.ts` (create)

**Interfaces:**
- Consumes: `scoreManualEvent` (Task 3), `listManualResults` (Task 2), SP1 `requireLeagueRole`, SP3's TBA path inside `buildRoundView`.
- Produces:
  - `type RoundScoreSource = { teams: Map<string, TeamScore>; qualsComplete: boolean; rpMethod: RpMethod; teamNames: Record<string, string>; hasEventData: boolean; hasRankings: boolean; fetchedAt: string | null; stale: boolean }` and `scoreSourceFor(round: RoundRow, now: Date): Promise<RoundScoreSource>` (`lib/rounds/scoreSource.ts`; Task 15 adds a `season` field)
  - `loadPool(round, now)` answers manual rounds from `round_extra_teams` only (no TBA call)
  - `POST /api/l/{slug}/admin/rounds` accepts `{ kind: 'manual', name, startDate, endDate }` as well as v1's `{ eventKey }`; answers 409 for season leagues
  - `seedLeague(repo, { format })` test option

- [ ] **Step 1: Let tests seed a season league**

In `tests/helpers/api.ts`, add `format?: LeagueFormat` to `seedLeague`'s `opts` and pass `format: opts.format` into the `repo.createLeague({...})` call (import `LeagueFormat` from `@/lib/db/types`). Everything else in SP1's helper stays.

- [ ] **Step 2: Write the failing route tests**

In `tests/api/rounds.test.ts` (SP1 already switched it to sessions; `h.user = user` makes the request come from the commissioner), append:

```ts
describe('POST rounds: manual events (spec §5.3)', () => {
  const manual = (body: unknown) => addRound(request('POST', '/x', { body }), params({ slug: league.slug }));

  it('creates a manual round without asking TBA', async () => {
    const res = await manual({ kind: 'manual', name: '  Garage Games ', startDate: '2026-11-07', endDate: '2026-11-08' });
    expect(res.status).toBe(201);
    const [round] = await repo.listRounds(league.id);
    expect(round).toMatchObject({
      kind: 'manual', eventKey: null, eventName: 'Garage Games',
      startDate: '2026-11-07', endDate: '2026-11-08', timezone: 'America/New_York',
    });
    expect(round.scoring).toEqual(league.defaultScoring);
    expect(h.getTba).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: 'manual', name: '', startDate: '2026-11-07', endDate: '2026-11-07' }, 'Event name is required'],
    [{ kind: 'manual', name: 'x'.repeat(81), startDate: '2026-11-07', endDate: '2026-11-07' }, 'Event name must be 80 characters or fewer'],
    [{ kind: 'manual', name: 'G', startDate: '11/07/2026', endDate: '2026-11-07' }, 'Dates look like 2026-11-07'],
    [{ kind: 'manual', name: 'G', startDate: '2026-02-30', endDate: '2026-03-01' }, 'Dates look like 2026-11-07'],
    [{ kind: 'manual', name: 'G', startDate: '2026-11-08', endDate: '2026-11-07' }, 'The end date must be on or after the start date'],
  ])('rejects %j', async (body, message) => {
    const res = await manual(body);
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe(message);
  });

  it('still takes a v1 body with only an event key', async () => {
    tbaAnswers({ '/event/2025parr': EVENT });
    const res = await manual({ eventKey: '2025parr' });
    expect(res.status).toBe(201);
    expect((await repo.listRounds(league.id))[0]).toMatchObject({ kind: 'tba', eventKey: '2025parr' });
  });

  it('answers 409 in a season league (its rounds are created for it)', async () => {
    const season = await seedLeague(repo, { slug: 'season-fam-abc234', format: 'season' });
    h.user = season.user;
    const res = await addRound(
      request('POST', '/x', { body: { kind: 'manual', name: 'G', startDate: '2026-11-07', endDate: '2026-11-07' } }),
      params({ slug: season.league.slug }),
    );
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('Season leagues add their season rounds automatically');
  });
});
```

(`tbaAnswers` and `EVENT` already exist in this file; if SP1 renamed `seedLeague`'s slug option, use its name.)

- [ ] **Step 3: Write the failing pool test**

Create `tests/rounds/pool.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import type { Repo } from '@/lib/db/repo';
import { loadPool } from '@/lib/rounds/pool';
import { defaultScoring } from '@/lib/scoring/config';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
const NOW = new Date('2026-11-01T12:00:00.000Z');

beforeEach(() => {
  repo = createMemoryRepo();
  h.repo = repo;
  h.getTba = vi.fn(async () => ({ data: null, fetchedAt: null, stale: true }));
});

describe('loadPool for a manual round', () => {
  it('is exactly the hand-added teams, sorted, with no TBA call', async () => {
    const { league } = await seedLeague(repo);
    const round = await repo.createRound({
      leagueId: league.id, eventKey: null, kind: 'manual', eventName: 'Garage Games',
      startDate: '2026-11-07', endDate: '2026-11-07', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    await repo.addExtraTeam(round.id, 'frc5181');
    await repo.addExtraTeam(round.id, 'frc341');
    const pool = await loadPool(round, NOW);
    expect(pool.teams.map((t) => t.teamKey)).toEqual(['frc341', 'frc5181']);
    expect(pool).toMatchObject({ stale: false, tbaCount: 0 });
    expect(h.getTba).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Write the failing view test**

Create `tests/views/manualRound.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { loadRoundPage } from '@/lib/views/round';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

const NOW = new Date('2026-11-09T12:00:00.000Z');
let repo: Repo;
let league: LeagueRow;
let round: RoundRow;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  h.getTba = vi.fn(async () => {
    throw new Error('a manual round must never call TBA');
  });
  ({ league } = await seedLeague(repo));
  round = await repo.createRound({
    leagueId: league.id, eventKey: null, kind: 'manual', eventName: 'Garage Games',
    startDate: '2026-11-07', endDate: '2026-11-07', timezone: 'America/New_York', scoring: defaultScoring(),
  });
});

describe('a manual round page', () => {
  it('shows "no data" and zero points before results are typed in', async () => {
    const page = await loadRoundPage(league.slug, round.id, NOW);
    expect(page!.view).toMatchObject({ hasEventData: false, hasRankings: false, qualsComplete: false, rpMethod: 'manual', stale: false });
  });

  it('scores drafted teams from the typed-in results', async () => {
    const mom = await repo.createMember({ leagueId: league.id, userId: crypto.randomUUID(), name: 'Mom', role: 'player' });
    await repo.addExtraTeam(round.id, 'frc5181');
    await repo.updateRound(round.id, { draftOrder: [mom.id], rosterSize: 1 });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc5181' });
    await repo.upsertManualResult({
      roundId: round.id, teamKey: 'frc5181', qualWins: 5, qualLosses: 1, qualTies: 0, rankingPoints: null,
      qualRank: 2, allianceRole: 'captain', playoffWins: 0, eventResult: null, awardTypes: [],
    });
    const page = await loadRoundPage(league.slug, round.id, NOW);
    const momScore = page!.view.scores.find((s) => s.playerId === mom.id)!;
    expect(momScore.total).toBe(5 * 3 + 5 + 8); // record + rank 2 tier + captain
    expect(page!.view).toMatchObject({ hasEventData: true, hasRankings: true, qualsComplete: true });
  });
});
```

(`insertPick` may need SP4's `auto` field — pass `auto: false` if the type requires it.)

- [ ] **Step 5: Run them to make sure they fail**

Run: `npx vitest run tests/api/rounds.test.ts tests/rounds/pool.test.ts tests/views/manualRound.test.ts`
Expected: FAIL — manual body rejected (400 "Event key is required"), pool calls TBA, the round view has no manual path.

- [ ] **Step 6: Give manual rounds their own pool**

In `lib/rounds/pool.ts`, replace the Task 1 guard with an explicit branch at the top of `loadPool`:

```ts
export async function loadPool(
  round: RoundRow,
  now: Date,
): Promise<{ teams: PoolTeam[]; stale: boolean; tbaCount: number }> {
  if (round.kind === 'manual' || !round.eventKey) {
    // Manual events aren't on TBA: the pool is only what the commissioner typed in (spec §5.3).
    const extras = await getRepo().listExtraTeams(round.id);
    return { teams: mergePool(null, extras), stale: false, tbaCount: 0 };
  }
  const [tba, extras] = await Promise.all([
    getTba<TeamSimple[]>(`/event/${round.eventKey}/teams/simple`, { windowMs: cacheWindowFor(round, now) }),
    getRepo().listExtraTeams(round.id),
  ]);
  const tbaTeams = Array.isArray(tba.data) ? tba.data : null;
  return { teams: mergePool(tbaTeams, extras), stale: tba.stale, tbaCount: tbaTeams?.length ?? 0 };
}
```

(Task 12 adds the `season` branch above the manual one.)

- [ ] **Step 7: Add the scoring dispatcher**

Create `lib/rounds/scoreSource.ts`. The `tbaSource` body is **moved, not rewritten**: cut the TBA part of `buildRoundView` (SP3's version — from the `getEventScores`/`loadEventData` call through the `teamNames` / `hasEventData` / `hasRankings` / staleness computation and the "scoring failed → empty data, stale" fallback) into it and return the fields below. The v1 shape of that code is shown for orientation; keep SP3's cached path exactly as SP3 left it.

```ts
import { getRepo } from '@/lib/db';
import type { RoundRow } from '@/lib/db/types';
import { scoreManualEvent } from '@/lib/scoring/manual';
import type { RpMethod, TeamScore } from '@/lib/scoring/types';

/** What any round kind contributes to its round page: scored teams plus what the page says about the data. */
export type RoundScoreSource = {
  teams: Map<string, TeamScore>;
  qualsComplete: boolean;
  rpMethod: RpMethod;
  /** teamKey -> nickname, for teams TBA knows about. */
  teamNames: Record<string, string>;
  hasEventData: boolean;
  hasRankings: boolean;
  fetchedAt: string | null;
  stale: boolean;
};

/** The one place round kinds differ when scoring (spec §5.2). Everything downstream uses the team map. */
export async function scoreSourceFor(round: RoundRow, now: Date): Promise<RoundScoreSource> {
  if (round.kind === 'manual') return manualSource(round);
  return tbaSource(round, now);
}

async function manualSource(round: RoundRow): Promise<RoundScoreSource> {
  const results = await getRepo().listManualResults(round.id);
  const scored = scoreManualEvent(results, round.scoring);
  return {
    teams: scored.teams,
    qualsComplete: scored.qualsComplete,
    rpMethod: scored.rpMethod,
    teamNames: {},
    hasEventData: results.length > 0,
    hasRankings: results.some((r) => r.qualRank !== null),
    fetchedAt: null,
    stale: false,
  };
}

async function tbaSource(round: RoundRow, now: Date): Promise<RoundScoreSource> {
  // ── moved from buildRoundView (SP3 version). In v1 it read: ──
  // const loaded = await loadEventData(round.eventKey!, { windowMs: cacheWindowFor(round, now) });
  // const data = cleanEventData(loaded.data);
  // …scoreEvent with the try/catch fallback…
  // return { teams: event.teams, qualsComplete, rpMethod, teamNames, hasEventData, hasRankings,
  //          fetchedAt: loaded.fetchedAt, stale: loaded.stale || scoringFailed };
}
```

The comment block is replaced by the moved code; the function must return a `RoundScoreSource`. `cleanEventData` stays exported from `lib/views/round.ts` (import it from there) so its tests don't move.

- [ ] **Step 8: Use it in `buildRoundView`**

In `lib/views/round.ts`, `buildRoundView` becomes:

```ts
export async function buildRoundView(
  round: RoundRow,
  allPlayers: PlayerRow[],
  picks: PickRow[],
  adjustments: AdjustmentRow[],
  now: Date,
): Promise<RoundView> {
  const source = await scoreSourceFor(round, now);
  const players = roundPlayers(allPlayers, round.draftOrder, adjustments);
  return {
    round,
    status: roundStatus(round, picks.length, now), // keep SP4's live-draft variant if it passes more arguments
    scores: scoreRound(source.teams, picks, adjustments, players),
    picks,
    adjustments,
    teamNames: source.teamNames,
    qualsComplete: source.qualsComplete,
    rpMethod: source.rpMethod,
    hasEventData: source.hasEventData,
    hasRankings: source.hasRankings,
    fetchedAt: source.fetchedAt,
    stale: source.stale,
  };
}
```

Remove imports that are now unused (`scoreEvent`, `loadEventData`, `cacheWindowFor`), and add `import { scoreSourceFor } from '@/lib/rounds/scoreSource';`. `lib/rounds/scoreSource.ts` imports `cleanEventData` from `lib/views/round.ts` and `lib/views/round.ts` imports `scoreSourceFor` — that cycle is fine at runtime (both are used inside functions), but if you'd rather avoid it, move `cleanEventData` and `NO_EVENT_DATA` into `lib/rounds/scoreSource.ts` and re-export `cleanEventData` from `lib/views/round.ts`.

- [ ] **Step 9: Accept manual rounds in the create endpoint**

In `app/api/l/[slug]/admin/rounds/route.ts`, replace `bodySchema` and the top of `POST`:

```ts
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MSG = 'Dates look like 2026-11-07';
/** A real calendar day. Rejects 2026-02-30, which some engines roll into March and others call Invalid Date. */
function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const date = z.string(DATE_MSG).refine(isRealDate, DATE_MSG);

const tbaBody = z.strictObject({
  kind: z.literal('tba'),
  eventKey: z.string('Event key is required').max(40, 'Event keys look like 2025parr'),
});
const manualBody = z
  .strictObject({
    kind: z.literal('manual'),
    name: z
      .string('Event name is required')
      .trim()
      .min(1, 'Event name is required')
      .max(80, 'Event name must be 80 characters or fewer'),
    startDate: date,
    endDate: date,
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'The end date must be on or after the start date' });

// v1 clients send only { eventKey }: treat a body without `kind` as a TBA round.
const bodySchema = z.preprocess(
  (v) => (typeof v === 'object' && v !== null && !Array.isArray(v) && !('kind' in v) ? { ...v, kind: 'tba' } : v),
  z.discriminatedUnion('kind', [tbaBody, manualBody]),
);

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    if (league.format === 'season') {
      throw new HttpError(409, 'Season leagues add their season rounds automatically');
    }
    const body = await parseBody(req, bodySchema);

    if (body.kind === 'manual') {
      const round = await getRepo().createRound({
        leagueId: league.id,
        kind: 'manual',
        eventKey: null,
        eventName: body.name,
        startDate: body.startDate,
        endDate: body.endDate,
        timezone: 'America/New_York',
        scoring: structuredClone(league.defaultScoring),
      });
      return json(
        { round: { id: round.id, eventKey: null, eventName: round.eventName, startDate: round.startDate, endDate: round.endDate } },
        201,
      );
    }

    const eventKey = normalizeEventKey(body.eventKey);
    // …the rest of v1's TBA branch is unchanged…
```

(the file already imports `requireLeagueRole` after SP1; the old `DATE_RE` constant further down is now this one — delete the duplicate.)

- [ ] **Step 10: Word the round page for manual rounds**

In `app/l/[slug]/r/[roundId]/page.tsx`:

```tsx
  const manual = round.kind === 'manual';
```

and change the "not started" alert and the freshness line:

```tsx
          {notStarted ? (
            <Alert tone="info">{manual ? 'No results entered yet' : 'Event hasn’t started'}</Alert>
          ) : null}
```

```tsx
        {manual ? null : <Freshness fetchedAt={view.fetchedAt} stale={view.stale} now={now} />}
```

- [ ] **Step 11: Run the tests**

Run: `npx vitest run tests/api/rounds.test.ts tests/rounds/pool.test.ts tests/views/manualRound.test.ts tests/views/views.test.ts`
Expected: PASS, including every existing TBA view test (proof that `tbaSource` was moved without changing behavior).

- [ ] **Step 12: Run the gates**

Run: `npm run typecheck && npm test`
Expected: clean, all pass.

- [ ] **Step 13: Commit**

```bash
git add lib/rounds/scoreSource.ts lib/rounds/pool.ts lib/views/round.ts "app/api/l/[slug]/admin/rounds/route.ts" \
  "app/l/[slug]/r/[roundId]/page.tsx" tests
git commit -m "feat(sp2): manual rounds — create, pool from hand-added teams, score from results

Co-Authored-By: <the session's attribution line>"
```

---

### Task 6: Manual results endpoints

**Files:**
- Create: `app/api/l/[slug]/admin/rounds/[id]/results/[teamKey]/route.ts`
- Modify: `lib/rounds/detail.ts`, `lib/api/types.ts`
- Test: `tests/api/manualResults.test.ts`

**Interfaces:**
- Consumes: `upsertManualResult`, `deleteManualResult`, `listManualResults` (Task 2), `loadPool` (Task 5), v1 `parseTeamInput`, SP1 `requireLeagueRole`.
- Produces:
  - `PUT /api/l/{slug}/admin/rounds/{id}/results/{teamKey}` body `ManualResultInput` (all fields optional, defaults 0 / null / `[]`) → `200 { result: ManualResult }`; 400 bad team / not in pool / bad field; 409 not a manual round.
  - `DELETE` same path → 204.
  - `AdminRoundDetail.manualResults: ManualResult[] | null` (null unless the round is manual).

- [ ] **Step 1: Write the failing tests**

Create `tests/api/manualResults.test.ts` (start with the session/db/TBA mock block from "Test conventions" at the top of this plan), then:

```ts
import {
  DELETE as clearResult,
  PUT as putResult,
} from '@/app/api/l/[slug]/admin/rounds/[id]/results/[teamKey]/route';
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
  h.getTba = vi.fn(async () => ({ data: null, fetchedAt: null, stale: true }));
  const seeded = await seedLeague(repo);
  league = seeded.league;
  h.user = seeded.user;
  round = await repo.createRound({
    leagueId: league.id, eventKey: null, kind: 'manual', eventName: 'Garage Games',
    startDate: '2026-11-07', endDate: '2026-11-07', timezone: 'America/New_York', scoring: defaultScoring(),
  });
  await repo.addExtraTeam(round.id, 'frc341');
  await repo.addExtraTeam(round.id, 'frc5181');
});

const at = (teamKey: string, r: RoundRow = round) => params({ slug: league.slug, id: r.id, teamKey });
const put = (teamKey: string, body: unknown, r?: RoundRow) => putResult(request('PUT', '/x', { body }), at(teamKey, r));

describe('PUT manual result', () => {
  it('saves a full result and fills defaults for missing fields', async () => {
    const res = await put('frc5181', { qualWins: 7, qualLosses: 2, qualRank: 3, allianceRole: 'captain', awardTypes: [0] });
    expect(res.status).toBe(200);
    expect((await readJson(res)).result).toEqual({
      teamKey: 'frc5181', qualWins: 7, qualLosses: 2, qualTies: 0, rankingPoints: null, qualRank: 3,
      allianceRole: 'captain', playoffWins: 0, eventResult: null, awardTypes: [0],
    });
    expect(await repo.listManualResults(round.id)).toHaveLength(1);
  });

  it('replaces the whole row on a second save', async () => {
    await put('frc5181', { qualWins: 7, awardTypes: [0] });
    await put('frc5181', { qualWins: 8 });
    expect((await repo.listManualResults(round.id))[0]).toMatchObject({ qualWins: 8, awardTypes: [] });
  });

  it('accepts a team typed as "341" or " frc341 " (Review Focus 3)', async () => {
    expect((await put('341', { qualWins: 1 })).status).toBe(200);
    expect((await put(' frc341 ', { qualWins: 2 })).status).toBe(200);
    expect((await repo.listManualResults(round.id)).map((r) => [r.teamKey, r.qualWins])).toEqual([['frc341', 2]]);
  });

  it('rejects a team outside the pool and junk team input (Review Focus 3)', async () => {
    const outside = await put('254', { qualWins: 1 });
    expect(outside.status).toBe(400);
    expect((await readJson(outside)).error).toBe("That team isn't in this round's team pool");
    const junk = await put('34a1', { qualWins: 1 });
    expect(junk.status).toBe(400);
    expect((await readJson(junk)).error).toBe('Team numbers look like 341');
  });

  it.each([
    [{ qualWins: 51 }, 'Qual wins must be a whole number from 0 to 50'],
    [{ qualTies: -1 }, 'Qual ties must be a whole number from 0 to 50'],
    [{ rankingPoints: 501 }, 'Ranking points must be a whole number from 0 to 500'],
    [{ qualRank: 0 }, 'Rank must be a whole number from 1 to 200'],
    [{ playoffWins: 21 }, 'Playoff wins must be a whole number from 0 to 20'],
    [{ allianceRole: 'pick4' }, 'Alliance role must be captain, pick1, pick2, pick3 or backup'],
    [{ eventResult: 'semifinalist' }, 'Event result must be winner or finalist'],
    [{ awardTypes: [0, 0] }, 'Each award can only be listed once'],
  ])('rejects %j', async (body, message) => {
    const res = await put('frc5181', body);
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe(message);
  });

  it('answers 409 for a TBA round', async () => {
    const tbaRound = await repo.createRound({
      leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
      startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    const res = await put('frc5181', { qualWins: 1 }, tbaRound);
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('Results can only be entered for manual events');
  });

  it('is commissioner-only', async () => {
    h.user = null;
    expect((await put('frc5181', {})).status).toBe(401);
  });
});

describe('DELETE manual result', () => {
  it('clears the row', async () => {
    await put('frc5181', { qualWins: 7 });
    const res = await clearResult(request('DELETE', '/x'), at('5181'));
    expect(res.status).toBe(204);
    expect(await repo.listManualResults(round.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/api/manualResults.test.ts`
Expected: FAIL — `Cannot find module …/results/[teamKey]/route`.

- [ ] **Step 3: Write the route**

Create `app/api/l/[slug]/admin/rounds/[id]/results/[teamKey]/route.ts`:

```ts
import { z } from 'zod';
import { handle, HttpError, json, noContent, parseBody, requireRound } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { loadPool } from '@/lib/rounds/pool';
import { parseTeamInput } from '@/lib/teams';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string; teamKey: string }> };

const whole = (what: string, min: number, max: number) => {
  const msg = `${what} must be a whole number from ${min} to ${max}`;
  return z.number(msg).int(msg).min(min, msg).max(max, msg);
};

const bodySchema = z.strictObject({
  qualWins: whole('Qual wins', 0, 50).default(0),
  qualLosses: whole('Qual losses', 0, 50).default(0),
  qualTies: whole('Qual ties', 0, 50).default(0),
  rankingPoints: whole('Ranking points', 0, 500).nullable().default(null),
  qualRank: whole('Rank', 1, 200).nullable().default(null),
  allianceRole: z
    .enum(['captain', 'pick1', 'pick2', 'pick3', 'backup'], 'Alliance role must be captain, pick1, pick2, pick3 or backup')
    .nullable()
    .default(null),
  playoffWins: whole('Playoff wins', 0, 20).default(0),
  eventResult: z.enum(['winner', 'finalist'], 'Event result must be winner or finalist').nullable().default(null),
  awardTypes: z
    .array(whole('Award type', 0, 1000))
    .max(10, 'At most 10 awards per team')
    .refine((a) => new Set(a).size === a.length, 'Each award can only be listed once')
    .default([]),
});

async function manualTarget(ctx: Ctx) {
  const { slug, id, teamKey: raw } = await ctx.params;
  const { league } = await requireLeagueRole(slug, 'commissioner');
  const round = await requireRound(league, id);
  if (round.kind !== 'manual') throw new HttpError(409, 'Results can only be entered for manual events');
  const teamKey = parseTeamInput(raw);
  if (!teamKey) throw new HttpError(400, 'Team numbers look like 341');
  return { round, teamKey };
}

export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { round, teamKey } = await manualTarget(ctx);
    const body = await parseBody(req, bodySchema);
    const pool = await loadPool(round, new Date());
    if (!pool.teams.some((t) => t.teamKey === teamKey)) {
      throw new HttpError(400, "That team isn't in this round's team pool");
    }
    const { roundId: _roundId, ...result } = await getRepo().upsertManualResult({ roundId: round.id, teamKey, ...body });
    return json({ result });
  });
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { round, teamKey } = await manualTarget(ctx);
    await getRepo().deleteManualResult(round.id, teamKey);
    return noContent();
  });
}
```

(SP1 may export `requireRound` from a different module now that `lib/api/http.ts` no longer holds commissioner auth — import it from wherever SP1 left it.)

- [ ] **Step 4: Include results in the round admin detail**

In `lib/api/types.ts` add to `AdminRoundDetail`:

```ts
  /** Typed-in results (spec §5.3). null unless the round is a manual event. */
  manualResults: ManualResult[] | null;
```

In `lib/rounds/detail.ts`, load them alongside the others and add to the returned object:

```ts
    round.kind === 'manual' ? repo.listManualResults(round.id) : Promise.resolve(null),
```

```ts
    manualResults: manualRows ? manualRows.map(({ roundId: _roundId, ...r }) => r) : null,
```

(name the destructured `Promise.all` element `manualRows`.)

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/api/manualResults.test.ts tests/api/rounds.test.ts`
Expected: PASS

- [ ] **Step 6: Run the gates**

Run: `npm run typecheck && npm test`
Expected: clean, all pass.

- [ ] **Step 7: Commit**

```bash
git add "app/api/l/[slug]/admin/rounds/[id]/results" lib/rounds/detail.ts lib/api/types.ts tests/api/manualResults.test.ts
git commit -m "feat(sp2): manual results endpoints (PUT/DELETE per team)

Co-Authored-By: <the session's attribution line>"
```

---

### Task 7: Results UI and "Add round → Manual event"

**Files:**
- Create: `components/admin/ManualResultsEditor.tsx`, `components/admin/AddManualRoundForm.tsx`
- Modify: `components/admin/RoundAdmin.tsx`, `components/admin/AdminDashboard.tsx`, `lib/api/types.ts`, `app/api/l/[slug]/admin/state/route.ts`
- Test: `tests/ui/manualResults.test.ts`

**Interfaces:**
- Consumes: `AdminRoundDetail.manualResults` (Task 6), `AWARD_CHOICES` (Task 3), the manual `POST /rounds` body (Task 5), v1 `SectionProps` from `RoundAdmin.tsx`.
- Produces:
  - `orderResultRows(pool: PoolTeam[], picks: { teamKey: string }[], showAll: boolean): PoolTeam[]` — drafted teams first in pick order; all teams only when `showAll` (or when nothing is drafted)
  - `resultSummary(r: ManualResult | undefined): string`
  - `type ResultDraft` + `toDraft(r?: ManualResult): ResultDraft` + `fromDraft(d: ResultDraft): Omit<ManualResult, 'teamKey'>`
  - `AdminLeague.format: LeagueFormat` in `GET /admin/state`

The spec calls it a "Results tab"; the round admin page is a stack of cards (v1), so this is a **Results** card placed right after the Draft card, shown only for manual rounds.

- [ ] **Step 1: Write the failing tests**

Create `tests/ui/manualResults.test.ts`:

```ts
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AddManualRoundForm } from '@/components/admin/AddManualRoundForm';
import {
  fromDraft,
  ManualResultsEditor,
  orderResultRows,
  resultSummary,
  toDraft,
} from '@/components/admin/ManualResultsEditor';
import type { AdminRoundDetail } from '@/lib/api/types';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import type { ManualResult } from '@/lib/scoring/types';
import { mergePool } from '@/lib/teams';

const pool = mergePool(null, ['frc1', 'frc2', 'frc3', 'frc4']);
const full: ManualResult = {
  teamKey: 'frc2', qualWins: 7, qualLosses: 2, qualTies: 1, rankingPoints: 20, qualRank: 3,
  allianceRole: 'captain', playoffWins: 4, eventResult: 'winner', awardTypes: [0],
};

describe('orderResultRows', () => {
  it('lists drafted teams in pick order, and everyone else only when asked', () => {
    const picks = [{ teamKey: 'frc3' }, { teamKey: 'frc1' }];
    expect(orderResultRows(pool, picks, false).map((t) => t.teamKey)).toEqual(['frc3', 'frc1']);
    expect(orderResultRows(pool, picks, true).map((t) => t.teamKey)).toEqual(['frc3', 'frc1', 'frc2', 'frc4']);
  });

  it('shows every team when nothing has been drafted yet', () => {
    expect(orderResultRows(pool, [], false)).toHaveLength(4);
  });
});

describe('resultSummary', () => {
  it('reads like a scoreboard line', () => {
    expect(resultSummary(full)).toBe('7-2-1 · #3 · Captain · Winner · 1 award');
    expect(resultSummary(undefined)).toBe('No result yet');
    expect(resultSummary({ ...full, qualRank: null, allianceRole: null, eventResult: null, awardTypes: [0, 9] })).toBe(
      '7-2-1 · 2 awards',
    );
  });
});

describe('toDraft / fromDraft', () => {
  it('round-trips a full result', () => {
    const { teamKey: _t, ...rest } = full;
    expect(fromDraft(toDraft(full))).toEqual(rest);
  });

  it('turns blanks into 0 for counts and null for rank and RP', () => {
    expect(fromDraft(toDraft(undefined))).toEqual({
      qualWins: 0, qualLosses: 0, qualTies: 0, rankingPoints: null, qualRank: null,
      allianceRole: null, playoffWins: 0, eventResult: null, awardTypes: [],
    });
  });

  it('sends -1 for text that is not a whole number, so the server explains the rule', () => {
    expect(fromDraft({ ...toDraft(undefined), qualWins: '2.5', qualRank: 'abc' })).toMatchObject({ qualWins: -1, qualRank: -1 });
  });
});

describe('ManualResultsEditor', () => {
  const detail = {
    round: { id: 'r1', kind: 'manual', scoring: DEFAULT_SCORING },
    pool,
    picks: [{ pickNumber: 0, playerId: 'p1', teamKey: 'frc2' }],
    manualResults: [full],
  } as unknown as AdminRoundDetail;
  const html = renderToStaticMarkup(
    h(ManualResultsEditor, { detail, busy: false, run: async () => {}, api: (async () => ({})) as never, playerNames: {} }),
  );

  it('starts with only drafted teams and a "Show all teams" button', () => {
    expect(html).toContain('Team 2');
    expect(html).not.toContain('Team 4');
    expect(html).toContain('Show all teams');
    expect(html).toContain('7-2-1 · #3 · Captain · Winner · 1 award');
  });
});

describe('AddManualRoundForm', () => {
  it('asks for a name and two dates', () => {
    const html = renderToStaticMarkup(h(AddManualRoundForm, { busy: false, saving: false, onAdd: async () => true }));
    for (const label of ['Event name', 'Start date', 'End date', 'Add manual event']) expect(html).toContain(label);
    expect(html).toContain('type="date"');
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/ui/manualResults.test.ts`
Expected: FAIL — cannot find the two component modules.

- [ ] **Step 3: Write `AddManualRoundForm`**

Create `components/admin/AddManualRoundForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Plus } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';

export type ManualRoundInput = { name: string; startDate: string; endDate: string };

/** "Add round → Manual event" (spec §5.3): for events that aren't on The Blue Alliance. */
export function AddManualRoundForm({
  busy,
  saving,
  onAdd,
}: {
  busy: boolean;
  saving: boolean;
  /** Resolves to true when the round was added; the form clears only then. */
  onAdd: (input: ManualRoundInput) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onAdd({ name: name.trim(), startDate, endDate: endDate || startDate })) {
          setName('');
          setStartDate('');
          setEndDate('');
        }
      }}
    >
      <Input label="Event name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder="Garage Games" />
      <div className="grid grid-cols-2 gap-2">
        <Input label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        <Input
          label="End date"
          type="date"
          value={endDate}
          min={startDate || undefined}
          onChange={(e) => setEndDate(e.target.value)}
          hint="Blank = same day"
        />
      </div>
      <Button type="submit" variant="accent" busy={saving} disabled={busy || name.trim() === '' || startDate === ''}>
        {saving ? null : <Plus className="size-4 shrink-0" />}
        Add manual event
      </Button>
      <p className="text-[13px] leading-[18px] text-fg-muted">
        Manual events aren&apos;t on The Blue Alliance. You add the teams, then type in their results afterwards.
      </p>
    </form>
  );
}
```

- [ ] **Step 4: Write `ManualResultsEditor`**

Create `components/admin/ManualResultsEditor.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { SectionProps } from '@/components/admin/RoundAdmin';
import { Button } from '@/components/ui/Button';
import { BumperPlate } from '@/components/ui/BumperPlate';
import { ChevronDown } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { AWARD_CHOICES } from '@/lib/scoring/awardTypes';
import type { ScoringConfig } from '@/lib/scoring/config';
import type { AllianceRole, ManualResult } from '@/lib/scoring/types';
import type { PoolTeam } from '@/lib/teams';

const ROLE_TEXT: Record<AllianceRole, string> = {
  captain: 'Captain',
  pick1: '1st pick',
  pick2: '2nd pick',
  pick3: '3rd pick',
  backup: 'Backup',
};

/** Drafted teams first (in pick order); the rest only when asked, or when nobody is drafted yet. */
export function orderResultRows(pool: PoolTeam[], picks: { teamKey: string }[], showAll: boolean): PoolTeam[] {
  const byKey = new Map(pool.map((t) => [t.teamKey, t]));
  const drafted = picks.map((p) => byKey.get(p.teamKey)).filter((t): t is PoolTeam => t !== undefined);
  if (drafted.length === 0) return pool;
  if (!showAll) return drafted;
  const taken = new Set(drafted.map((t) => t.teamKey));
  return [...drafted, ...pool.filter((t) => !taken.has(t.teamKey))];
}

export function resultSummary(r: ManualResult | undefined): string {
  if (!r) return 'No result yet';
  const parts = [`${r.qualWins}-${r.qualLosses}-${r.qualTies}`];
  if (r.qualRank !== null) parts.push(`#${r.qualRank}`);
  if (r.allianceRole) parts.push(ROLE_TEXT[r.allianceRole]);
  if (r.eventResult) parts.push(r.eventResult === 'winner' ? 'Winner' : 'Finalist');
  if (r.awardTypes.length > 0) parts.push(`${r.awardTypes.length} award${r.awardTypes.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** The form's own copy of a result: text boxes hold strings until Save. */
export type ResultDraft = {
  qualWins: string;
  qualLosses: string;
  qualTies: string;
  rankingPoints: string;
  qualRank: string;
  allianceRole: '' | AllianceRole;
  playoffWins: string;
  eventResult: '' | 'winner' | 'finalist';
  awardTypes: number[];
};

const text = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

export function toDraft(r?: ManualResult): ResultDraft {
  return {
    qualWins: r ? String(r.qualWins) : '',
    qualLosses: r ? String(r.qualLosses) : '',
    qualTies: r ? String(r.qualTies) : '',
    rankingPoints: text(r?.rankingPoints),
    qualRank: text(r?.qualRank),
    allianceRole: r?.allianceRole ?? '',
    playoffWins: r ? String(r.playoffWins) : '',
    eventResult: r?.eventResult ?? '',
    awardTypes: r?.awardTypes ?? [],
  };
}

/** Anything that isn't a whole number becomes -1, which the server rejects with the field's rule. */
function whole(s: string): number {
  const n = Number(s.trim());
  return Number.isInteger(n) ? n : -1;
}
const count = (s: string) => (s.trim() === '' ? 0 : whole(s));
const maybe = (s: string) => (s.trim() === '' ? null : whole(s));

export function fromDraft(d: ResultDraft): Omit<ManualResult, 'teamKey'> {
  return {
    qualWins: count(d.qualWins),
    qualLosses: count(d.qualLosses),
    qualTies: count(d.qualTies),
    rankingPoints: maybe(d.rankingPoints),
    qualRank: maybe(d.qualRank),
    allianceRole: d.allianceRole === '' ? null : d.allianceRole,
    playoffWins: count(d.playoffWins),
    eventResult: d.eventResult === '' ? null : d.eventResult,
    awardTypes: d.awardTypes,
  };
}

function ResultForm({
  initial,
  scoring,
  busy,
  onSave,
  onClear,
}: {
  initial: ManualResult | undefined;
  scoring: ScoringConfig;
  busy: boolean;
  onSave: (body: Omit<ManualResult, 'teamKey'>) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [d, setD] = useState<ResultDraft>(() => toDraft(initial));
  const set = <K extends keyof ResultDraft>(key: K, value: ResultDraft[K]) => setD((prev) => ({ ...prev, [key]: value }));
  const num = (key: 'qualWins' | 'qualLosses' | 'qualTies' | 'rankingPoints' | 'qualRank' | 'playoffWins', label: string) => (
    <Input label={label} type="number" inputMode="numeric" min={0} value={d[key]} onChange={(e) => set(key, e.target.value)} />
  );
  const excluded = new Set(scoring.awards.excludedTypes);
  return (
    <form
      className="space-y-4 pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        await onSave(fromDraft(d));
      }}
    >
      <div className="grid grid-cols-3 gap-2">
        {num('qualWins', 'Wins')}
        {num('qualLosses', 'Losses')}
        {num('qualTies', 'Ties')}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {num('qualRank', 'Final rank')}
        {num('rankingPoints', 'Ranking points')}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select label="Alliance" value={d.allianceRole} onChange={(e) => set('allianceRole', e.target.value as ResultDraft['allianceRole'])}>
          <option value="">Not picked</option>
          {(Object.keys(ROLE_TEXT) as AllianceRole[]).map((role) => (
            <option key={role} value={role}>
              {ROLE_TEXT[role]}
            </option>
          ))}
        </Select>
        {num('playoffWins', 'Playoff wins')}
      </div>
      <Select label="Event result" value={d.eventResult} onChange={(e) => set('eventResult', e.target.value as ResultDraft['eventResult'])}>
        <option value="">Neither</option>
        <option value="winner">Winner</option>
        <option value="finalist">Finalist</option>
      </Select>
      <fieldset className="space-y-1">
        <legend className="text-sm font-semibold text-fg">Awards</legend>
        {AWARD_CHOICES.map((a) => (
          <label key={a.type} className="flex min-h-11 items-center gap-3 text-[15px] text-fg">
            <input
              type="checkbox"
              className="size-5 shrink-0 accent-primary"
              checked={d.awardTypes.includes(a.type)}
              onChange={(e) =>
                set('awardTypes', e.target.checked ? [...d.awardTypes, a.type] : d.awardTypes.filter((t) => t !== a.type))
              }
            />
            <span className="min-w-0">
              {a.name}
              {excluded.has(a.type) ? <span className="text-fg-muted"> (not scored in this round)</span> : null}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          Save result
        </Button>
        {initial ? (
          <Button type="button" variant="danger" disabled={busy} onClick={() => onClear()}>
            Clear result
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** The Results card of a manual round (spec §5.3): one row per pool team, drafted teams first. */
export function ManualResultsEditor({ detail, busy, run, api }: SectionProps) {
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const results = new Map((detail.manualResults ?? []).map((r) => [r.teamKey, r]));
  const rows = orderResultRows(detail.pool, detail.picks, showAll);
  const hidden = detail.pool.length - rows.length;
  const path = (teamKey: string) => `/rounds/${detail.round.id}/results/${encodeURIComponent(teamKey)}`;

  if (detail.pool.length === 0) {
    return <p className="text-[15px] text-fg-muted">Add teams to the pool (Setup) before entering results.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-[15px] text-fg-muted">Type in each team&apos;s final results. Scores update as soon as you save.</p>
      <ul className="divide-y divide-border">
        {rows.map((team) => (
          <li key={team.teamKey} className="py-1">
            <button
              type="button"
              aria-expanded={open === team.teamKey}
              onClick={() => setOpen(open === team.teamKey ? null : team.teamKey)}
              className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-1 text-left hover:bg-surface-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BumperPlate number={team.label} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[15px] text-fg">{team.nickname ?? ''}</span>
              <span className="shrink-0 text-[13px] text-fg-muted tabular-nums">{resultSummary(results.get(team.teamKey))}</span>
              <ChevronDown className="size-5 shrink-0 text-fg-muted" />
            </button>
            {open === team.teamKey ? (
              <ResultForm
                key={JSON.stringify(results.get(team.teamKey) ?? null)}
                initial={results.get(team.teamKey)}
                scoring={detail.round.scoring}
                busy={busy}
                onSave={(body) => run(() => api(path(team.teamKey), { method: 'PUT', body }), `Saved ${team.label}.`)}
                onClear={() => run(() => api(path(team.teamKey), { method: 'DELETE' }), `Cleared ${team.label}.`)}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {hidden > 0 || showAll ? (
        <Button type="button" variant="secondary" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show drafted teams only' : 'Show all teams'}
        </Button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Wire the card into the round admin**

In `components/admin/RoundAdmin.tsx`, import `ManualResultsEditor` and add after the Draft `<section>`:

```tsx
      {round.kind === 'manual' ? (
        <section>
          <Card title="Results">
            <ManualResultsEditor {...section} />
          </Card>
        </section>
      ) : null}
```

and wrap the "Refresh from TBA" `Button` in `{round.kind === 'tba' ? (…) : null}`. Change the grey note under it to:

```tsx
          <p className="text-xs text-fg-muted">
            {round.kind === 'tba'
              ? 'Refresh is limited to once every 15 seconds. Marking final only changes the badge and slows down checks for new data; scores are always computed from The Blue Alliance.'
              : 'Marking final only changes the badge.'}
          </p>
```

- [ ] **Step 6: Offer "TBA event | Manual event" on the dashboard**

In `lib/api/types.ts` add `format: LeagueFormat;` to `AdminLeague`; in `app/api/l/[slug]/admin/state/route.ts` add `format: league.format,` to `state.league`.

In `components/admin/AdminDashboard.tsx`, add `const [addKind, setAddKind] = useState<'tba' | 'manual'>('tba');` next to the other state, import `AddManualRoundForm` and `ManualRoundInput`, and replace the `<AddRoundForm …/>` element and the grey event-key hint under it with:

```tsx
          {state.league.format === 'event' ? (
            <div className="space-y-3">
              <div role="group" aria-label="Kind of round to add" className="flex gap-2">
                {(['tba', 'manual'] as const).map((kind) => (
                  <Button
                    key={kind}
                    type="button"
                    size="sm"
                    variant={addKind === kind ? 'primary' : 'secondary'}
                    aria-pressed={addKind === kind}
                    onClick={() => setAddKind(kind)}
                  >
                    {kind === 'tba' ? 'TBA event' : 'Manual event'}
                  </Button>
                ))}
              </div>
              {addKind === 'tba' ? (
                <>
                  {/* …the existing <AddRoundForm …/> element, unchanged… */}
                  <p className="text-[13px] leading-[18px] text-fg-muted">
                    The event key is the last part of the event&apos;s address on thebluealliance.com, such as 2026parr.
                  </p>
                </>
              ) : (
                <AddManualRoundForm
                  busy={busy}
                  saving={pending === 'add-manual'}
                  onAdd={(input: ManualRoundInput) =>
                    run(
                      'add-manual',
                      () => api('/rounds', { method: 'POST', body: { kind: 'manual', ...input } }),
                      `Added ${input.name}. Add its teams under Manage → Setup.`,
                    )
                  }
                />
              )}
            </div>
          ) : null}
```

(The existing `AddRoundForm` JSX moves inside the `addKind === 'tba'` branch as-is. Season leagues show no add-round controls; Task 17 adds their "Start next season" button.)

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/ui/manualResults.test.ts tests/ui/admin-components.test.ts`
Expected: PASS

- [ ] **Step 8: Run the gates and look at it**

Run: `npm run typecheck && npm test`
Expected: clean, all pass.

Then `npm run dev`, sign in as a commissioner of a test league, add a manual event, add two teams under Setup, open Results, save a result for each, and open the public round page. Check at 360 px wide in both themes: rows don't scroll sideways, the award checkboxes are ≥ 44 px tall, and the round page says "No results entered yet" before the first save.

- [ ] **Step 9: Commit**

```bash
git add components/admin lib/api/types.ts "app/api/l/[slug]/admin/state/route.ts" tests/ui/manualResults.test.ts
git commit -m "feat(sp2): Results card for manual rounds and 'Add round → Manual event'

Co-Authored-By: <the session's attribution line>"
```

---

### Task 8: Follow-a-team — the event filter and `syncFollowedEvents`

**Files:**
- Modify: `lib/tba/types.ts` (add `EventSimple`)
- Create: `lib/follow/filter.ts`, `lib/follow/sync.ts`
- Test: `tests/follow/filter.test.ts`, `tests/follow/sync.test.ts`

**Interfaces:**
- Consumes: Task 2 repo methods (`listFollows`, `listSkippedEvents`, `createRoundIfAbsent`, `updateLeague` with `followsSyncedAt`), SP1 `PlayerRow.userId`, v1 `getTba`, `localDate`, `addDays`, `DEFAULT_WINDOW_MS`.
- Produces:
  - `type EventSimple = { key: string; name: string; event_type: number; start_date: string; end_date: string; year?: number; city?: string | null; state_prov?: string | null; country?: string | null; district?: { key: string; abbreviation: string; display_name?: string } | null }` (`lib/tba/types.ts`)
  - `pickFollowEvents(events: EventSimple[], opts: { today: string; existing: Set<string>; skipped: Set<string> }): EventSimple[]` (`lib/follow/filter.ts`)
  - `syncFollowedEvents(league: LeagueRow, now: Date): Promise<{ ok: boolean; added: RoundRow[] }>` (`lib/follow/sync.ts`)

- [ ] **Step 1: Write the failing filter tests**

Create `tests/follow/filter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pickFollowEvents } from '@/lib/follow/filter';
import type { EventSimple } from '@/lib/tba/types';

const ev = (key: string, event_type: number, start: string, end = start): EventSimple => ({
  key, name: key, event_type, start_date: start, end_date: end,
});
const TODAY = '2026-10-10';
const none = { existing: new Set<string>(), skipped: new Set<string>() };

describe('pickFollowEvents (spec §5.4)', () => {
  it('keeps official and offseason events, drops preseason and unlabeled', () => {
    const events = [
      ev('2026paca', 1, '2026-10-20'),
      ev('2026parr', 99, '2026-10-24'),
      ev('2026week0', 100, '2026-10-20'),
      ev('2026mystery', -1, '2026-10-20'),
      ev('2026cmptx', 4, '2026-10-30'),
    ];
    expect(pickFollowEvents(events, { today: TODAY, ...none }).map((e) => e.key)).toEqual([
      '2026paca',
      '2026parr',
      '2026cmptx',
    ]);
  });

  it('keeps an event that ended yesterday, drops one that ended two days ago', () => {
    const events = [ev('2026a', 99, '2026-10-08', '2026-10-09'), ev('2026b', 99, '2026-10-07', '2026-10-08')];
    expect(pickFollowEvents(events, { today: TODAY, ...none }).map((e) => e.key)).toEqual(['2026a']);
  });

  it('skips events already in the league and ones the commissioner deleted (Review Focus 1)', () => {
    const events = [ev('2026a', 99, '2026-10-20'), ev('2026b', 99, '2026-10-21'), ev('2026c', 99, '2026-10-22')];
    const out = pickFollowEvents(events, { today: TODAY, existing: new Set(['2026a']), skipped: new Set(['2026b']) });
    expect(out.map((e) => e.key)).toEqual(['2026c']);
  });

  it('lists an event once when two followed teams both attend, in date order', () => {
    const events = [ev('2026z', 99, '2026-11-01'), ev('2026a', 99, '2026-10-20'), ev('2026z', 99, '2026-11-01')];
    expect(pickFollowEvents(events, { today: TODAY, ...none }).map((e) => e.key)).toEqual(['2026a', '2026z']);
  });

  it('ignores junk rows (bad key or dates)', () => {
    const events = [
      { ...ev('2026a', 99, '2026-10-20'), key: 'not a key' },
      { ...ev('2026b', 99, '2026-10-20'), end_date: '' },
    ] as EventSimple[];
    expect(pickFollowEvents(events, { today: TODAY, ...none })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/follow/filter.test.ts`
Expected: FAIL — `Cannot find module '@/lib/follow/filter'`.

- [ ] **Step 3: Add `EventSimple` and write the filter**

In `lib/tba/types.ts` append:

```ts
/** TBA Event_Simple, as returned by /team/{key}/events/{year}/simple and /events/{year}/simple. No timezone. */
export type EventSimple = {
  key: string;
  name: string;
  /** 0 Regional · 1 District · 2 District Championship · 3 Champs Division · 4 Champs Finals ·
   *  5 District Champs Division · 99 Offseason · 100 Preseason · -1 Unlabeled */
  event_type: number;
  start_date: string; // YYYY-MM-DD
  end_date: string;
  year?: number;
  city?: string | null;
  state_prov?: string | null;
  country?: string | null;
  district?: { key: string; abbreviation: string; display_name?: string } | null;
};
```

Create `lib/follow/filter.ts`:

```ts
import { addDays } from '@/lib/rounds/status';
import type { EventSimple } from '@/lib/tba/types';
import { EVENT_KEY_RE } from '@/lib/teams';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Preseason and unlabeled events are never auto-added. Offseason (99) is: Ramp Riot is one. */
const NEVER = new Set([100, -1]);

/** Pure: which of a followed team's events become new rounds (spec §5.4 step 2). */
export function pickFollowEvents(
  events: EventSimple[],
  opts: { today: string; existing: Set<string>; skipped: Set<string> },
): EventSimple[] {
  const cutoff = addDays(opts.today, -1);
  const seen = new Set<string>();
  const out: EventSimple[] = [];
  for (const e of events) {
    if (!e || !EVENT_KEY_RE.test(e.key ?? '') || !DATE_RE.test(e.start_date ?? '') || !DATE_RE.test(e.end_date ?? '')) {
      continue;
    }
    if (NEVER.has(e.event_type) || e.end_date < cutoff) continue;
    if (opts.existing.has(e.key) || opts.skipped.has(e.key) || seen.has(e.key)) continue;
    seen.add(e.key);
    out.push(e);
  }
  return out.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.key.localeCompare(b.key));
}
```

- [ ] **Step 4: Run the filter tests**

Run: `npx vitest run tests/follow/filter.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing sync tests**

Create `tests/follow/sync.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import type { Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { syncFollowedEvents } from '@/lib/follow/sync';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

const NOW = new Date('2026-10-10T14:00:00.000Z');
let repo: Repo;
let league: LeagueRow;

const ev = (key: string, event_type: number, start: string, end = start) => ({
  key, name: `Event ${key}`, event_type, start_date: start, end_date: end,
});

/** TBA: team events by path, plus /event/{key} for the timezone. Anything else is "no data". */
function tba(byTeam: Record<number, unknown[]>, opts: { failTeam?: number } = {}) {
  h.getTba = vi.fn(async (path: unknown) => {
    const p = String(path);
    const team = /^\/team\/frc(\d+)\/events\/2026\/simple$/.exec(p);
    if (team) {
      if (Number(team[1]) === opts.failTeam) return { data: null, fetchedAt: null, stale: true };
      return { data: byTeam[Number(team[1])] ?? [], fetchedAt: NOW.toISOString(), stale: false };
    }
    const event = /^\/event\/(\w+)$/.exec(p);
    if (event) return { data: { key: event[1], timezone: 'America/Chicago' }, fetchedAt: NOW.toISOString(), stale: false };
    return { data: null, fetchedAt: null, stale: false };
  });
}

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  ({ league } = await seedLeague(repo));
  await repo.setFollows(league.id, [5181]);
});

describe('syncFollowedEvents', () => {
  it('creates auto-added TBA rounds with the league scoring and default roster 4', async () => {
    tba({ 5181: [ev('2026parr', 99, '2026-10-24'), ev('2026week0', 100, '2026-10-20')] });
    const out = await syncFollowedEvents(league, NOW);
    expect(out.ok).toBe(true);
    const rounds = await repo.listRounds(league.id);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({
      kind: 'tba', eventKey: '2026parr', eventName: 'Event 2026parr', startDate: '2026-10-24',
      timezone: 'America/Chicago', autoAdded: true, rosterSize: 4, draftOrder: [],
    });
    expect(rounds[0].scoring).toEqual(DEFAULT_SCORING);
    expect((await repo.getLeagueBySlug(league.slug))!.followsSyncedAt).toBe(NOW.toISOString());
  });

  it('copies roster size and the linked players of the most recently created round', async () => {
    const mom = await repo.createMember({ leagueId: league.id, userId: crypto.randomUUID(), name: 'Mom', role: 'player' });
    const gone = await repo.createMember({ leagueId: league.id, userId: crypto.randomUUID(), name: 'Gone', role: 'player' });
    await repo.updatePlayer(gone.id, { userId: null });
    const base = { eventName: 'x', timezone: 'America/New_York', scoring: DEFAULT_SCORING };
    const older = await repo.createRound({ leagueId: league.id, eventKey: '2026old', startDate: '2026-12-01', endDate: '2026-12-01', ...base });
    await repo.updateRound(older.id, { rosterSize: 2 });
    const newer = await repo.createRound({ leagueId: league.id, eventKey: '2026new', startDate: '2026-09-01', endDate: '2026-09-01', ...base });
    await repo.updateRound(newer.id, { rosterSize: 6, draftOrder: [gone.id, mom.id] });
    tba({ 5181: [ev('2026parr', 99, '2026-10-24')] });
    await syncFollowedEvents(league, NOW);
    const added = (await repo.listRounds(league.id)).find((r) => r.eventKey === '2026parr')!;
    expect(added).toMatchObject({ rosterSize: 6, draftOrder: [mom.id] });
  });

  it('never re-adds a skipped event (Review Focus 1)', async () => {
    await repo.addSkippedEvent(league.id, '2026parr');
    tba({ 5181: [ev('2026parr', 99, '2026-10-24')] });
    await syncFollowedEvents(league, NOW);
    expect(await repo.listRounds(league.id)).toEqual([]);
  });

  it('on a TBA failure creates nothing and leaves followsSyncedAt alone', async () => {
    await repo.setFollows(league.id, [5181, 341]);
    tba({ 5181: [ev('2026parr', 99, '2026-10-24')] }, { failTeam: 341 });
    const out = await syncFollowedEvents(league, NOW);
    expect(out).toEqual({ ok: false, added: [] });
    expect(await repo.listRounds(league.id)).toEqual([]);
    expect((await repo.getLeagueBySlug(league.slug))!.followsSyncedAt).toBeNull();
  });

  it('two syncs at once make each round once (Review Focus 2)', async () => {
    await repo.setFollows(league.id, [5181, 341]);
    tba({ 5181: [ev('2026parr', 99, '2026-10-24')], 341: [ev('2026parr', 99, '2026-10-24'), ev('2026mrcmp', 2, '2026-10-30')] });
    const [a, b] = await Promise.all([syncFollowedEvents(league, NOW), syncFollowedEvents(league, NOW)]);
    expect(a.added.length + b.added.length).toBe(2);
    expect((await repo.listRounds(league.id)).map((r) => r.eventKey).sort()).toEqual(['2026mrcmp', '2026parr']);
  });

  it('does nothing for a season league', async () => {
    const season = await seedLeague(repo, { slug: 'season-fam-abc234', format: 'season' });
    await repo.setFollows(season.league.id, [5181]);
    tba({ 5181: [ev('2026parr', 99, '2026-10-24')] });
    expect(await syncFollowedEvents(season.league, NOW)).toEqual({ ok: true, added: [] });
    expect(h.getTba).not.toHaveBeenCalled();
  });

  it('with no follows, marks the league synced without calling TBA', async () => {
    await repo.setFollows(league.id, []);
    tba({});
    expect(await syncFollowedEvents(league, NOW)).toEqual({ ok: true, added: [] });
    expect(h.getTba).not.toHaveBeenCalled();
    expect((await repo.getLeagueBySlug(league.slug))!.followsSyncedAt).toBe(NOW.toISOString());
  });
});
```

- [ ] **Step 6: Run them to make sure they fail**

Run: `npx vitest run tests/follow/sync.test.ts`
Expected: FAIL — `Cannot find module '@/lib/follow/sync'`.

- [ ] **Step 7: Write the sync**

Create `lib/follow/sync.ts`:

```ts
import { getRepo } from '@/lib/db';
import type { LeagueRow, RoundRow } from '@/lib/db/types';
import { pickFollowEvents } from '@/lib/follow/filter';
import { DEFAULT_WINDOW_MS, localDate } from '@/lib/rounds/status';
import { getTba } from '@/lib/tba/client';
import type { EventSimple, TbaEvent } from '@/lib/tba/types';

const EASTERN = 'America/New_York';

/**
 * Creates rounds for the events a league's followed teams attend (spec §5.4). Safe to run
 * concurrently: rounds are inserted with ON CONFLICT DO NOTHING. A TBA failure changes nothing.
 */
export async function syncFollowedEvents(league: LeagueRow, now: Date): Promise<{ ok: boolean; added: RoundRow[] }> {
  if (league.format !== 'event') return { ok: true, added: [] };
  const repo = getRepo();
  const follows = await repo.listFollows(league.id);
  if (follows.length === 0) {
    await repo.updateLeague(league.id, { followsSyncedAt: now.toISOString() });
    return { ok: true, added: [] };
  }

  const today = localDate(now, EASTERN);
  const year = Number(today.slice(0, 4));
  const lists = await Promise.all(
    follows.map((n) => getTba<EventSimple[]>(`/team/frc${n}/events/${year}/simple`, { windowMs: DEFAULT_WINDOW_MS })),
  );
  if (lists.some((l) => l.stale)) {
    console.error(`Follow sync for ${league.slug}: TBA unavailable, trying again later`);
    return { ok: false, added: [] };
  }

  const [rounds, skipped, players] = await Promise.all([
    repo.listRounds(league.id),
    repo.listSkippedEvents(league.id),
    repo.listPlayers(league.id),
  ]);
  const events = pickFollowEvents(
    lists.flatMap((l) => (Array.isArray(l.data) ? l.data : [])),
    {
      today,
      existing: new Set(rounds.map((r) => r.eventKey).filter((k): k is string => k !== null)),
      skipped: new Set(skipped),
    },
  );

  // Draft order and roster size come from the league's most recently *created* round (not the latest by date).
  const template = [...rounds].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const linked = new Set(players.filter((p) => p.userId !== null).map((p) => p.id));
  const draftOrder = template ? template.draftOrder.filter((id) => linked.has(id)) : [];
  const rosterSize = template ? Math.min(template.rosterSize, 10) : 4;

  const added: RoundRow[] = [];
  for (const e of events) {
    // Event_Simple has no timezone; one small look-up per *new* event gets it (fallback Eastern).
    const full = await getTba<TbaEvent>(`/event/${e.key}`, { windowMs: DEFAULT_WINDOW_MS });
    const round = await repo.createRoundIfAbsent({
      leagueId: league.id,
      kind: 'tba',
      eventKey: e.key,
      eventName: e.name.slice(0, 200),
      startDate: e.start_date,
      endDate: e.end_date,
      timezone: full.data?.timezone || EASTERN,
      scoring: structuredClone(league.defaultScoring),
      autoAdded: true,
      rosterSize,
      draftOrder,
    });
    if (round) added.push(round);
  }
  await repo.updateLeague(league.id, { followsSyncedAt: now.toISOString() });
  return { ok: true, added };
}
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run tests/follow`
Expected: PASS (12 tests)

- [ ] **Step 9: Run the gates**

Run: `npm run typecheck && npm test`
Expected: clean, all pass.

- [ ] **Step 10: Commit**

```bash
git add lib/tba/types.ts lib/follow tests/follow
git commit -m "feat(sp2): follow-a-team event filter and idempotent syncFollowedEvents

Co-Authored-By: <the session's attribution line>"
```

---

### Task 9: Follow-teams setting, "Auto-added" note, deleted auto-rounds stay deleted, home team retired

**Files:**
- Create: `app/api/l/[slug]/admin/follows/route.ts`, `lib/follow/input.ts`, `components/admin/FollowTeamsForm.tsx`
- Modify: `app/api/l/[slug]/admin/rounds/[id]/route.ts` (DELETE), `app/api/l/[slug]/admin/league/route.ts`, `app/api/l/[slug]/admin/state/route.ts`, `lib/api/types.ts`, `components/admin/AdminDashboard.tsx`
- Test: `tests/api/follows.test.ts`, `tests/follow/input.test.ts`, `tests/api/rounds.test.ts` (append), `tests/api/league.test.ts` (edit)

**Interfaces:**
- Consumes: `setFollows`, `listFollows`, `addSkippedEvent` (Task 2), `syncFollowedEvents` (Task 8).
- Produces:
  - `PUT /api/l/{slug}/admin/follows` body `{ teams: number[] }` (0–3 distinct numbers 1–99999) → `200 { follows: number[]; added: number; synced: boolean }`; 409 for season leagues.
  - `parseFollowInput(text: string): { teams: number[] } | { error: string }` and `autoAddedNote(follows: number[]): string` (`lib/follow/input.ts`)
  - `AdminLeague` loses `homeTeamNumber`, gains `follows: number[]`; `PATCH /admin/league` no longer accepts `homeTeamNumber` (400 as an unknown field) and never accepts `format`.

- [ ] **Step 1: Write the failing pure tests**

Create `tests/follow/input.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { autoAddedNote, parseFollowInput } from '@/lib/follow/input';

describe('parseFollowInput', () => {
  it('reads numbers separated by commas or spaces, dropping repeats', () => {
    expect(parseFollowInput('5181, 341 5181')).toEqual({ teams: [5181, 341] });
    expect(parseFollowInput('  ')).toEqual({ teams: [] });
    expect(parseFollowInput('frc5181')).toEqual({ teams: [5181] });
  });

  it('explains what is wrong', () => {
    expect(parseFollowInput('1, 2, 3, 4')).toEqual({ error: 'Follow at most 3 teams' });
    expect(parseFollowInput('51a81')).toEqual({ error: '"51a81" isn\'t a team number' });
    expect(parseFollowInput('0')).toEqual({ error: '"0" isn\'t a team number' });
  });
});

describe('autoAddedNote', () => {
  it('names the followed teams', () => {
    expect(autoAddedNote([5181])).toBe('Auto-added · following 5181');
    expect(autoAddedNote([341, 5181])).toBe('Auto-added · following 341, 5181');
    expect(autoAddedNote([])).toBe('Auto-added');
  });
});
```

- [ ] **Step 2: Write the failing route tests**

Create `tests/api/follows.test.ts` (start with the mock block from "Test conventions"), then:

```ts
import { PUT as putFollows } from '@/app/api/l/[slug]/admin/follows/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  h.getTba = vi.fn(async (path: unknown) =>
    String(path) === '/team/frc5181/events/2026/simple'
      ? { data: [{ key: '2026parr', name: 'Ramp Riot', event_type: 99, start_date: '2099-10-24', end_date: '2099-10-24' }], fetchedAt: 'x', stale: false }
      : { data: null, fetchedAt: 'x', stale: false },
  );
  const seeded = await seedLeague(repo);
  league = seeded.league;
  h.user = seeded.user;
});

const put = (teams: unknown, slug = league.slug) =>
  putFollows(request('PUT', '/x', { body: { teams } }), params({ slug }));

describe('PUT /admin/follows', () => {
  it('saves the list and syncs right away', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // only Date: promises and timers keep running
    vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'));
    const res = await put([5181]);
    vi.useRealTimers();
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ follows: [5181], added: 1, synced: true });
    expect((await repo.listRounds(league.id)).map((r) => r.eventKey)).toEqual(['2026parr']);
  });

  it('clears the list', async () => {
    await repo.setFollows(league.id, [5181]);
    const res = await put([]);
    expect(await readJson(res)).toEqual({ follows: [], added: 0, synced: true });
    expect(await repo.listFollows(league.id)).toEqual([]);
  });

  it.each([
    [[1, 2, 3, 4], 'Follow at most 3 teams'],
    [[5181, 5181], 'Each team can only be followed once'],
    [[0], 'Team numbers are 1 to 99999'],
    [[100000], 'Team numbers are 1 to 99999'],
    [['5181'], 'Team numbers are 1 to 99999'],
  ])('rejects %j', async (teams, message) => {
    const res = await put(teams);
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe(message);
  });

  it('answers 409 in a season league', async () => {
    const season = await seedLeague(repo, { slug: 'season-fam-abc234', format: 'season' });
    h.user = season.user;
    const res = await put([5181], season.league.slug);
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('Only event-by-event leagues can follow teams');
  });

  it('is commissioner-only', async () => {
    h.user = null;
    expect((await put([5181])).status).toBe(401);
  });
});
```

In `tests/api/rounds.test.ts`, in `describe('DELETE /admin/rounds/{id}', …)` append:

```ts
  it('remembers a deleted auto-added round so follow-a-team never re-adds it (Review Focus 1)', async () => {
    const auto = await repo.createRound({
      leagueId: league.id, eventKey: '2026paca', eventName: 'Chesapeake', startDate: '2026-10-20',
      endDate: '2026-10-20', timezone: 'America/New_York', scoring: defaultScoring(), autoAdded: true,
    });
    expect((await deleteRound(request('DELETE', '/x'), at(auto))).status).toBe(204);
    expect(await repo.listSkippedEvents(league.id)).toEqual(['2026paca']);
  });

  it('does not skip an event whose round was added by hand', async () => {
    const byHand = await repo.createRound({
      leagueId: league.id, eventKey: '2026paca', eventName: 'Chesapeake', startDate: '2026-10-20',
      endDate: '2026-10-20', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    await deleteRound(request('DELETE', '/x'), at(byHand));
    expect(await repo.listSkippedEvents(league.id)).toEqual([]);
  });
```

In `tests/api/league.test.ts`:
- In the `GET /admin/state` expectation, replace `homeTeamNumber: 5181` with `format: 'event', follows: []`, and add `kind: 'tba', autoAdded: false, seasonYear: null` to the round summary.
- Rename `'updates the default scoring and home team'` to `'updates the default scoring'`, drop `homeTeamNumber: 341` from its body and the `homeTeamNumber` expectation.
- In `'answers 400 for invalid scoring, an empty patch, or unknown fields'`, keep `{ homeTeamNumber: 0 }` (now an unknown field → still 400) and add `{ homeTeamNumber: 341 }` and `{ format: 'season' }` — the league format can never change (spec §5.1).

- [ ] **Step 3: Run them to make sure they fail**

Run: `npx vitest run tests/follow/input.test.ts tests/api/follows.test.ts tests/api/rounds.test.ts tests/api/league.test.ts`
Expected: FAIL — missing modules, no skipped event on delete, `homeTeamNumber` still accepted.

- [ ] **Step 4: Write the pure helpers**

Create `lib/follow/input.ts`:

```ts
export const MAX_FOLLOWS = 3;

/** "5181, 341" → [5181, 341]. Accepts commas or spaces and an optional "frc" prefix. */
export function parseFollowInput(text: string): { teams: number[] } | { error: string } {
  const teams: number[] = [];
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    const m = /^(?:frc)?0*([1-9][0-9]{0,4})$/i.exec(token);
    if (!m) return { error: `"${token}" isn't a team number` };
    const n = Number(m[1]);
    if (!teams.includes(n)) teams.push(n);
  }
  if (teams.length > MAX_FOLLOWS) return { error: `Follow at most ${MAX_FOLLOWS} teams` };
  return { teams };
}

export function autoAddedNote(follows: number[]): string {
  return follows.length === 0 ? 'Auto-added' : `Auto-added · following ${follows.join(', ')}`;
}
```

- [ ] **Step 5: Write the route**

Create `app/api/l/[slug]/admin/follows/route.ts`:

```ts
import { z } from 'zod';
import { handle, HttpError, json, parseBody } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { MAX_FOLLOWS } from '@/lib/follow/input';
import { syncFollowedEvents } from '@/lib/follow/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string }> };

const TEAM_MSG = 'Team numbers are 1 to 99999';
const bodySchema = z.strictObject({
  teams: z
    .array(z.number(TEAM_MSG).int(TEAM_MSG).min(1, TEAM_MSG).max(99999, TEAM_MSG), 'teams must be a list of team numbers')
    .max(MAX_FOLLOWS, `Follow at most ${MAX_FOLLOWS} teams`)
    .refine((t) => new Set(t).size === t.length, 'Each team can only be followed once'),
});

/** Replaces the league's followed teams (spec §5.4) and syncs right away so new rounds show up now. */
export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    if (league.format !== 'event') throw new HttpError(409, 'Only event-by-event leagues can follow teams');
    const { teams } = await parseBody(req, bodySchema);
    const repo = getRepo();
    await repo.setFollows(league.id, teams);
    const sync = await syncFollowedEvents(league, new Date());
    return json({ follows: await repo.listFollows(league.id), added: sync.added.length, synced: sync.ok });
  });
}
```

- [ ] **Step 6: Remember deleted auto-rounds**

In `app/api/l/[slug]/admin/rounds/[id]/route.ts` `DELETE`, before `deleteRound`:

```ts
    const repo = getRepo();
    if (round.autoAdded && round.eventKey) {
      // Spec §5.4: a deleted auto-added round must never come back on the next sync.
      await repo.addSkippedEvent(league.id, round.eventKey);
    }
    await repo.deleteRound(round.id);
```

- [ ] **Step 7: Retire the home team number; expose format and follows**

`app/api/l/[slug]/admin/league/route.ts`: delete the `homeTeamNumber` field from `patchSchema` (the `strictObject` now rejects it, and `format` was never in it) and delete `homeTeamNumber: saved.homeTeamNumber,` from the response.

`lib/api/types.ts` `AdminLeague`: remove `homeTeamNumber: number;`, add `follows: number[];` (`format` was added in Task 7).

`app/api/l/[slug]/admin/state/route.ts`: load follows with the other reads (`repo.listFollows(league.id)`), remove `homeTeamNumber` from `state.league`, add `follows`.

`LeaguePatch.homeTeamNumber` and the `home_team_number` mapping in `supabaseRepo.updateLeague` stay until migration `0006` drops the column (spec §8.2); nothing calls them any more.

- [ ] **Step 8: Follow-teams form and the auto-added note on the dashboard**

Create `components/admin/FollowTeamsForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { parseFollowInput } from '@/lib/follow/input';

/** League setting "Follow teams" (spec §5.4): their events become rounds automatically. */
export function FollowTeamsForm({
  follows,
  busy,
  saving,
  onSave,
}: {
  follows: number[];
  busy: boolean;
  saving: boolean;
  onSave: (teams: number[]) => Promise<boolean>;
}) {
  const [value, setValue] = useState(follows.join(', '));
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = parseFollowInput(value);
        if ('error' in parsed) {
          setError(parsed.error);
          return;
        }
        setError(null);
        await onSave(parsed.teams);
      }}
    >
      <Input
        label="Follow teams (up to 3)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="5181, 341"
        inputMode="numeric"
        error={error}
        hint="Their events this year are added as rounds automatically. Delete one and it stays deleted."
      />
      <Button type="submit" variant="secondary" busy={saving} disabled={busy}>
        Save followed teams
      </Button>
    </form>
  );
}
```

In `components/admin/AdminDashboard.tsx`:
- Import `FollowTeamsForm` and `autoAddedNote`.
- Inside the Rounds card, above the add-round controls and only when `state.league.format === 'event'`, render:

```tsx
            <FollowTeamsForm
              key={state.league.follows.join(',')}
              follows={state.league.follows}
              busy={busy}
              saving={pending === 'follows'}
              onSave={(teams) =>
                run('follows', async () => {
                  const out = await api<{ added: number; synced: boolean }>('/follows', { method: 'PUT', body: { teams } });
                  setNotice(
                    !out.synced
                      ? "Saved. Couldn't reach The Blue Alliance — new events will be added on the next check."
                      : out.added > 0
                        ? `Saved. Added ${out.added} ${out.added === 1 ? 'round' : 'rounds'}.`
                        : 'Saved.',
                  );
                })
              }
            />
```

- In each round's `EventRow` `lines`, append the note for auto rounds:

```tsx
                  lines={[
                    formatDateRange(round.startDate, round.endDate),
                    round.eventKey ?? (round.kind === 'manual' ? 'Manual event' : `${round.seasonYear} season`),
                    round.totalPicks === 0 ? 'Draft not set up' : `${round.pickCount} of ${round.totalPicks} picks`,
                    ...(round.autoAdded ? [autoAddedNote(state.league.follows)] : []),
                  ]}
```

- In the delete confirm text, add for auto rounds: `round.autoAdded ? ' Follow-a-team won’t add it again.' : ''`.

- [ ] **Step 9: Run the tests**

Run: `npx vitest run tests/follow tests/api/follows.test.ts tests/api/rounds.test.ts tests/api/league.test.ts`
Expected: PASS

- [ ] **Step 10: Run the gates**

Run: `npm run typecheck && npm test`
Expected: clean, all pass.

- [ ] **Step 11: Commit**

```bash
git add "app/api/l/[slug]/admin" lib/follow lib/api/types.ts components/admin tests
git commit -m "feat(sp2): follow-teams setting, auto-added note, deleted auto-rounds stay deleted

Co-Authored-By: <the session's attribution line>"
```

---

### Task 10: Sync on visit (`after()`) and in the daily cron

**Files:**
- Modify: `lib/follow/sync.ts` (add `shouldSyncOnVisit`, `scheduleFollowSync`, `followSyncJob`), `lib/cron/jobs.ts`, `app/l/[slug]/page.tsx`, `app/api/l/[slug]/admin/state/route.ts`, `vercel.json` (check only)
- Test: `tests/follow/schedule.test.ts`

**Interfaces:**
- Consumes: SP3's `DAILY_JOBS: { name: string; run(now: Date, deadline: number): Promise<void> }[]` (`lib/cron/jobs.ts`; `deadline` is an epoch-ms time the job must stop by), `listLeaguesWithFollows` (Task 2), `syncFollowedEvents` (Task 8), `after` from `next/server`.
- Produces:
  - `FOLLOW_SYNC_EVERY_MS = 10 * 60_000`
  - `shouldSyncOnVisit(league: LeagueRow, now: Date): boolean`
  - `scheduleFollowSync(league: LeagueRow, now?: Date): void` — queues a sync after the response when due; never throws
  - `followSyncJob` appended to `DAILY_JOBS`

- [ ] **Step 1: Write the failing tests**

Create `tests/follow/schedule.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
  afterCalls: [] as (() => unknown)[],
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => h.afterCalls.push(fn) }));

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
});

describe('followSyncJob', () => {
  it('syncs every league that follows someone', async () => {
    await repo.setFollows(league.id, [5181]);
    await followSyncJob.run(NOW, Date.now() + 60_000);
    expect((await repo.getLeagueBySlug(league.slug))!.followsSyncedAt).toBe(NOW.toISOString());
  });

  it('stops when the deadline has passed', async () => {
    await repo.setFollows(league.id, [5181]);
    await followSyncJob.run(NOW, Date.now() - 1);
    expect((await repo.getLeagueBySlug(league.slug))!.followsSyncedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/follow/schedule.test.ts`
Expected: FAIL — `shouldSyncOnVisit` is not exported.

- [ ] **Step 3: Add the schedule helpers and the job**

Append to `lib/follow/sync.ts` (add `import { after } from 'next/server';` at the top):

```ts
export const FOLLOW_SYNC_EVERY_MS = 10 * 60_000;

/** Spec §5.4 "on visit": only event leagues, and only when the last sync is missing or 10+ minutes old. */
export function shouldSyncOnVisit(league: LeagueRow, now: Date): boolean {
  if (league.format !== 'event') return false;
  if (!league.followsSyncedAt) return true;
  return now.getTime() - Date.parse(league.followsSyncedAt) >= FOLLOW_SYNC_EVERY_MS;
}

/** Runs the sync after the response is sent (Next.js after()), so a page view never waits on TBA. */
export function scheduleFollowSync(league: LeagueRow, now: Date = new Date()): void {
  if (!shouldSyncOnVisit(league, now)) return;
  after(async () => {
    try {
      await syncFollowedEvents(league, now);
    } catch (err) {
      console.error(`Follow sync for ${league.slug} failed`, err);
    }
  });
}

/** Daily cron job (spec §5.4): every league that follows a team, until the time budget runs out. */
export const followSyncJob = {
  name: 'follow-sync',
  async run(now: Date, deadline: number): Promise<void> {
    for (const league of await getRepo().listLeaguesWithFollows()) {
      if (Date.now() >= deadline) break;
      try {
        await syncFollowedEvents(league, now);
      } catch (err) {
        console.error(`Follow sync for ${league.slug} failed`, err);
      }
    }
  },
};
```

In `lib/cron/jobs.ts` (created by SP3), import `followSyncJob` and add it to `DAILY_JOBS` **after** SP3's `team_stats` job:

```ts
export const DAILY_JOBS = [/* …SP3's team_stats job… */, followSyncJob];
```

- [ ] **Step 4: Call it on visit**

`app/l/[slug]/page.tsx`: after the page data loads (and after SP1's visibility check lets the viewer in), add:

```tsx
  const leagueRow = await getRepo().getLeagueBySlug(slug);
  if (leagueRow) scheduleFollowSync(leagueRow, now);
```

(if SP1's page already holds the `LeagueRow` — e.g. from `requireLeagueView` — use that instead of a second query.) Imports: `getRepo` from `@/lib/db`, `scheduleFollowSync` from `@/lib/follow/sync`.

`app/api/l/[slug]/admin/state/route.ts` (the admin dashboard loads through it): after `requireLeagueRole`, add `scheduleFollowSync(league, now);`.

- [ ] **Step 5: Confirm the cron schedule**

Open `vercel.json` (SP3 created it). It must contain exactly this cron (spec §5.4):

```json
{ "crons": [{ "path": "/api/cron/daily", "schedule": "0 10 * * *" }] }
```

If SP3 used a different schedule, change it to `0 10 * * *`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/follow`
Expected: PASS

- [ ] **Step 7: Run the gates**

Run: `npm run typecheck && npm test`
Expected: clean, all pass. (If SP3 has a test listing `DAILY_JOBS` names, update it to include `'follow-sync'`.)

- [ ] **Step 8: Commit**

```bash
git add lib/follow lib/cron/jobs.ts "app/l/[slug]/page.tsx" "app/api/l/[slug]/admin/state/route.ts" vercel.json tests/follow
git commit -m "feat(sp2): follow-a-team sync on visit (after) and in the daily cron

Co-Authored-By: <the session's attribution line>"
```

---

### Task 11: Season calendar helpers

**Files:**
- Create: `lib/season/calendar.ts` (pure — the create-league form imports it in the browser), `lib/season/fetchDates.ts` (server)
- Modify: `lib/tba/types.ts` (`TeamSimple` location fields, `DistrictSimple`)
- Test: `tests/season/calendar.test.ts`

**Interfaces:**
- Consumes: `EventSimple` (Task 8), v1 `localDate`, `getTba`, `DEFAULT_WINDOW_MS`.
- Produces (`lib/season/calendar.ts`):
  - `SEASON_TIMEZONE = 'America/New_York'`, `DEFAULT_SEASON_ROSTER = 8`, `MAX_SEASON_ROSTER = 15`
  - `OFFICIAL_EVENT_TYPES: ReadonlySet<number>` = {0, 1, 2, 3, 4, 5}; `isOfficialEvent(e: { event_type: number }): boolean`
  - `defaultSeasonYear(now: Date): number`; `allowedSeasonYears(now: Date): number[]` (this calendar year and next)
  - `seasonRoundName(year: number): string` → `"2027 Season"`
  - `seasonDates(events: EventSimple[] | null, year: number): { startDate: string; endDate: string }`
  - `fetchSeasonDates(year: number): Promise<{ startDate: string; endDate: string; stale: boolean }>` (`lib/season/fetchDates.ts`)
  - `TeamSimple` += `city?`, `state_prov?`, `country?` (all `string | null`); `type DistrictSimple = { key: string; abbreviation: string; display_name: string; year: number }`

- [ ] **Step 1: Write the failing tests**

Create `tests/season/calendar.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getTba: undefined as unknown as (...args: unknown[]) => unknown }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import {
  allowedSeasonYears,
  defaultSeasonYear,
  isOfficialEvent,
  seasonDates,
  seasonRoundName,
} from '@/lib/season/calendar';
import { fetchSeasonDates } from '@/lib/season/fetchDates';
import type { EventSimple } from '@/lib/tba/types';

const ev = (key: string, event_type: number, start: string, end = start): EventSimple => ({
  key, name: key, event_type, start_date: start, end_date: end,
});

describe('official events (spec §5.5)', () => {
  it('counts regionals, districts, district champs (and divisions), champs divisions and finals', () => {
    for (const t of [0, 1, 2, 3, 4, 5]) expect(isOfficialEvent({ event_type: t }), String(t)).toBe(true);
  });
  it('never counts offseason, preseason or unlabeled events', () => {
    for (const t of [99, 100, -1, 6, 7]) expect(isOfficialEvent({ event_type: t }), String(t)).toBe(false);
  });
});

describe('defaultSeasonYear', () => {
  it('is this year until the end of September (Eastern), next year from October on', () => {
    expect(defaultSeasonYear(new Date('2026-09-30T12:00:00Z'))).toBe(2026);
    expect(defaultSeasonYear(new Date('2026-10-01T12:00:00Z'))).toBe(2027);
    // 2026-10-01 02:00 UTC is still Sept 30 in New York
    expect(defaultSeasonYear(new Date('2026-10-01T02:00:00Z'))).toBe(2026);
  });
  it('allows this calendar year and next', () => {
    expect(allowedSeasonYears(new Date('2026-10-23T12:00:00Z'))).toEqual([2026, 2027]);
  });
});

describe('seasonDates', () => {
  it('spans the earliest official start to the latest official end', () => {
    const events = [
      ev('2027week0', 100, '2027-02-13'),
      ev('2027paca', 1, '2027-03-05', '2027-03-07'),
      ev('2027cmptx', 4, '2027-04-17', '2027-04-19'),
      ev('2027parr', 99, '2027-10-23'),
    ];
    expect(seasonDates(events, 2027)).toEqual({ startDate: '2027-03-05', endDate: '2027-04-19' });
  });
  it('is the whole year before TBA publishes the calendar', () => {
    expect(seasonDates(null, 2027)).toEqual({ startDate: '2027-01-01', endDate: '2027-12-31' });
    expect(seasonDates([ev('2027parr', 99, '2027-10-23')], 2027)).toEqual({ startDate: '2027-01-01', endDate: '2027-12-31' });
  });
  it('names the round', () => {
    expect(seasonRoundName(2027)).toBe('2027 Season');
  });
});

describe('fetchSeasonDates', () => {
  beforeEach(() => {
    h.getTba = vi.fn(async () => ({ data: [ev('2027paca', 1, '2027-03-05', '2027-03-07')], fetchedAt: 'x', stale: false }));
  });
  it('reads /events/{year}/simple', async () => {
    expect(await fetchSeasonDates(2027)).toEqual({ startDate: '2027-03-05', endDate: '2027-03-07', stale: false });
    expect(h.getTba).toHaveBeenCalledWith('/events/2027/simple', expect.objectContaining({ windowMs: expect.any(Number) }));
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/season/calendar.test.ts`
Expected: FAIL — `Cannot find module '@/lib/season/calendar'`.

- [ ] **Step 3: Extend the TBA types**

In `lib/tba/types.ts`, change `TeamSimple` to:

```ts
export type TeamSimple = {
  key: string;
  team_number: number;
  nickname?: string | null;
  city?: string | null;
  state_prov?: string | null;
  country?: string | null;
};
```

and append:

```ts
/** /districts/{year} */
export type DistrictSimple = { key: string; abbreviation: string; display_name: string; year: number };
```

- [ ] **Step 4: Write the helpers**

Create `lib/season/calendar.ts`:

```ts
import { localDate } from '@/lib/rounds/status';
import type { EventSimple } from '@/lib/tba/types';

// Pure: no database or TBA imports, so client components (the create-league form) can use it.

export const SEASON_TIMEZONE = 'America/New_York';
export const DEFAULT_SEASON_ROSTER = 8;
export const MAX_SEASON_ROSTER = 15;

/** Spec §5.5: Regional, District, District Champs, Champs Division, Champs Finals, District Champs Division. */
export const OFFICIAL_EVENT_TYPES: ReadonlySet<number> = new Set([0, 1, 2, 3, 4, 5]);

export function isOfficialEvent(e: { event_type: number }): boolean {
  return OFFICIAL_EVENT_TYPES.has(e.event_type);
}

/** Current year, or next year from October on (Eastern time), spec §5.5. */
export function defaultSeasonYear(now: Date): number {
  const today = localDate(now, SEASON_TIMEZONE);
  const year = Number(today.slice(0, 4));
  return Number(today.slice(5, 7)) >= 10 ? year + 1 : year;
}

export function allowedSeasonYears(now: Date): number[] {
  const year = Number(localDate(now, SEASON_TIMEZONE).slice(0, 4));
  return [year, year + 1];
}

export function seasonRoundName(year: number): string {
  return `${year} Season`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Earliest official start to latest official end; the whole year until TBA publishes the calendar. */
export function seasonDates(events: EventSimple[] | null, year: number): { startDate: string; endDate: string } {
  const official = (events ?? []).filter(
    (e) => e && isOfficialEvent(e) && DATE_RE.test(e.start_date ?? '') && DATE_RE.test(e.end_date ?? ''),
  );
  if (official.length === 0) return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
  return {
    startDate: official.map((e) => e.start_date).sort()[0],
    endDate: official.map((e) => e.end_date).sort().at(-1)!,
  };
}
```

Create `lib/season/fetchDates.ts`:

```ts
import { DEFAULT_WINDOW_MS } from '@/lib/rounds/status';
import { seasonDates } from '@/lib/season/calendar';
import { getTba } from '@/lib/tba/client';
import type { EventSimple } from '@/lib/tba/types';

export async function fetchSeasonDates(year: number): Promise<{ startDate: string; endDate: string; stale: boolean }> {
  const res = await getTba<EventSimple[]>(`/events/${year}/simple`, { windowMs: DEFAULT_WINDOW_MS });
  return { ...seasonDates(Array.isArray(res.data) ? res.data : null, year), stale: res.stale };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/season/calendar.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/season/calendar.ts lib/season/fetchDates.ts lib/tba/types.ts tests/season/calendar.test.ts
git commit -m "feat(sp2): season calendar helpers (official events, season year, season dates)

Co-Authored-By: <the session's attribution line>"
```

---

### Task 12: Season pools — the four filters, the empty-pool message, the 1–15 roster rule

**Files:**
- Create: `lib/season/pool.ts`, `app/api/districts/[year]/route.ts`, `components/PoolFilterFields.tsx`
- Modify: `lib/rounds/pool.ts`, `app/api/l/[slug]/admin/rounds/[id]/route.ts` (PATCH), `lib/rounds/detail.ts`, `lib/api/types.ts`, `components/admin/RoundSetup.tsx`, SP4's `app/api/l/[slug]/admin/rounds/[id]/draft/start/route.ts`
- Test: `tests/season/pool.test.ts`, `tests/api/seasonRounds.test.ts`, `tests/ui/poolFilter.test.ts`

**Interfaces:**
- Consumes: `poolFilterSchema`, `PoolFilter`, `DEFAULT_POOL_FILTER` (Task 1), `MAX_SEASON_ROSTER` (Task 11), SP4's pool seam (`buildPoolEntries` is built on `loadPool`, so season pools reach the draft room without changes there).
- Produces:
  - `loadSeasonTbaTeams(year: number, filter: PoolFilter): Promise<{ teams: TeamSimple[]; stale: boolean }>`, `seasonEmptyMessage(year: number): string` (`lib/season/pool.ts`)
  - `loadPool(round, now)` now returns `{ teams; stale; tbaCount; emptyMessage: string | null }` and handles `season` rounds
  - `PATCH /admin/rounds/{id}` accepts `poolFilter` (season rounds only, before any pick) and roster sizes 1–15 for season rounds
  - `GET /api/districts/{year}` (signed in) → `{ districts: { key: string; name: string }[] }`
  - `AdminRoundDetail.poolEmptyMessage: string | null`; `maxRosterSize` capped at 15 for season rounds
  - `PoolFilterFields` (controlled component) + `poolFilterLabel(f: PoolFilter): string` (`components/PoolFilterFields.tsx`)

- [ ] **Step 1: Write the failing pool tests**

Create `tests/season/pool.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import type { Repo } from '@/lib/db/repo';
import { loadPool } from '@/lib/rounds/pool';
import { defaultScoring } from '@/lib/scoring/config';
import { loadSeasonTbaTeams, seasonEmptyMessage } from '@/lib/season/pool';
import type { TeamSimple } from '@/lib/tba/types';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

const t = (n: number, state_prov: string, country: string): TeamSimple => ({
  key: `frc${n}`, team_number: n, nickname: `Team ${n}`, state_prov, country,
});
const PAGE0 = [t(1, 'Pennsylvania', 'USA'), t(2, 'Ontario', 'Canada'), t(3, 'pennsylvania', 'usa')];
const PAGE1 = [t(501, 'Texas', 'USA')];
const DISTRICT = [t(1, 'Pennsylvania', 'USA'), t(5181, 'Pennsylvania', 'USA')];

function tba(pages: TeamSimple[][], opts: { stale?: boolean } = {}) {
  h.getTba = vi.fn(async (path: unknown) => {
    const p = String(path);
    const page = /^\/teams\/2027\/(\d+)\/simple$/.exec(p);
    if (page) return { data: pages[Number(page[1])] ?? [], fetchedAt: 'x', stale: opts.stale ?? false };
    if (p === '/district/2027fma/teams/simple') return { data: DISTRICT, fetchedAt: 'x', stale: false };
    return { data: null, fetchedAt: null, stale: false };
  });
}

beforeEach(() => {
  h.repo = createMemoryRepo();
});

describe('loadSeasonTbaTeams (spec §5.5)', () => {
  it('"all" walks pages until an empty page, with a 24 h window', async () => {
    tba([PAGE0, PAGE1]);
    const out = await loadSeasonTbaTeams(2027, { type: 'all' });
    expect(out.teams.map((x) => x.key)).toEqual(['frc1', 'frc2', 'frc3', 'frc501']);
    expect(h.getTba).toHaveBeenCalledTimes(3); // pages 0, 1 and the empty page 2
    expect(h.getTba).toHaveBeenCalledWith('/teams/2027/0/simple', { windowMs: 24 * 60 * 60_000 });
  });

  it('"district" reads the district team list', async () => {
    tba([PAGE0]);
    const out = await loadSeasonTbaTeams(2027, { type: 'district', key: '2027fma' });
    expect(out.teams.map((x) => x.key)).toEqual(['frc1', 'frc5181']);
  });

  it('"state" and "country" filter all teams, ignoring case and spaces', async () => {
    tba([PAGE0, PAGE1]);
    const pa = await loadSeasonTbaTeams(2027, { type: 'state', country: ' USA', state: 'Pennsylvania ' });
    expect(pa.teams.map((x) => x.key)).toEqual(['frc1', 'frc3']);
    const canada = await loadSeasonTbaTeams(2027, { type: 'country', country: 'canada' });
    expect(canada.teams.map((x) => x.key)).toEqual(['frc2']);
  });
});

describe('loadPool for a season round', () => {
  async function seasonRound(poolFilter: unknown = null) {
    const repo = h.repo as Repo;
    const { league } = await seedLeague(repo, { format: 'season' });
    return repo.createRound({
      leagueId: league.id, eventKey: null, kind: 'season', seasonYear: 2027, eventName: '2027 Season',
      startDate: '2027-01-01', endDate: '2027-12-31', timezone: 'America/New_York', scoring: defaultScoring(),
      poolFilter: poolFilter as never,
    });
  }

  it('uses the round filter (null = all teams)', async () => {
    tba([PAGE0]);
    const pool = await loadPool(await seasonRound(), new Date());
    expect(pool).toMatchObject({ tbaCount: 3, stale: false, emptyMessage: null });
  });

  it('explains an unpublished team list (Review Focus 5)', async () => {
    tba([]);
    const pool = await loadPool(await seasonRound(), new Date());
    expect(pool.teams).toEqual([]);
    expect(pool.emptyMessage).toBe("TBA hasn't published 2027 teams yet — usually by January.");
    expect(seasonEmptyMessage(2027)).toBe(pool.emptyMessage);
  });

  it('does not blame TBA for being empty when TBA just could not be reached', async () => {
    tba([], { stale: true });
    const pool = await loadPool(await seasonRound(), new Date());
    expect(pool).toMatchObject({ stale: true, tbaCount: 0, emptyMessage: null });
  });
});
```

- [ ] **Step 2: Write the failing route tests**

Create `tests/api/seasonRounds.test.ts` (start with the mock block from "Test conventions"), then:

```ts
import { PATCH as patchRound } from '@/app/api/l/[slug]/admin/rounds/[id]/route';
import { GET as getDistricts } from '@/app/api/districts/[year]/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, PlayerRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;
let me: PlayerRow;
let round: RoundRow;
let teamsPage0: unknown[];

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  teamsPage0 = Array.from({ length: 40 }, (_, i) => ({ key: `frc${i + 1}`, team_number: i + 1, country: 'USA', state_prov: 'Pennsylvania' }));
  h.getTba = vi.fn(async (path: unknown) => {
    const p = String(path);
    if (p === '/teams/2027/0/simple') return { data: teamsPage0, fetchedAt: 'x', stale: false };
    if (p === '/districts/2027') {
      return { data: [{ key: '2027fma', abbreviation: 'fma', display_name: 'FIRST Mid-Atlantic', year: 2027 }], fetchedAt: 'x', stale: false };
    }
    return { data: [], fetchedAt: 'x', stale: false };
  });
  const seeded = await seedLeague(repo, { format: 'season' });
  league = seeded.league;
  me = seeded.commissioner;
  h.user = seeded.user;
  round = await repo.createRound({
    leagueId: league.id, eventKey: null, kind: 'season', seasonYear: 2027, eventName: '2027 Season',
    startDate: '2027-01-01', endDate: '2027-12-31', timezone: 'America/New_York', scoring: defaultScoring(), rosterSize: 8,
  });
});

const patch = (body: unknown, r: RoundRow = round) =>
  patchRound(request('PATCH', '/x', { body }), params({ slug: league.slug, id: r.id }));

describe('PATCH a season round', () => {
  it('allows a roster of 15 but not 16', async () => {
    expect((await patch({ rosterSize: 15, draftOrder: [me.id] })).status).toBe(200);
    const res = await patch({ rosterSize: 16 });
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe('Roster size must be a whole number from 1 to 15');
  });

  it('still caps TBA rounds at 10', async () => {
    const tbaRound = await repo.createRound({
      leagueId: league.id, eventKey: '2027paca', eventName: 'x', startDate: '2027-03-05', endDate: '2027-03-07',
      timezone: 'America/New_York', scoring: defaultScoring(),
    });
    const res = await patch({ rosterSize: 11 }, tbaRound);
    expect((await readJson(res)).error).toBe('Roster size must be a whole number from 1 to 10');
  });

  it('saves a pool filter before the draft', async () => {
    const res = await patch({ poolFilter: { type: 'state', country: 'USA', state: 'Pennsylvania' } });
    expect(res.status).toBe(200);
    expect((await repo.getRound(round.id))!.poolFilter).toEqual({ type: 'state', country: 'USA', state: 'Pennsylvania' });
  });

  it('rejects a district from another season', async () => {
    const res = await patch({ poolFilter: { type: 'district', key: '2026fma' } });
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe('Pick a district from the 2027 season');
  });

  it('locks the pool filter once a pick exists', async () => {
    await repo.updateRound(round.id, { draftOrder: [me.id] });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: me.id, teamKey: 'frc1' });
    const res = await patch({ poolFilter: { type: 'country', country: 'Canada' } });
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('Undo all picks to change the team pool');
  });

  it('refuses a pool filter on a non-season round', async () => {
    const manual = await repo.createRound({
      leagueId: league.id, eventKey: null, kind: 'manual', eventName: 'x', startDate: '2027-03-05', endDate: '2027-03-05',
      timezone: 'America/New_York', scoring: defaultScoring(),
    });
    expect((await patch({ poolFilter: { type: 'all' } }, manual)).status).toBe(409);
  });

  it('explains an unpublished team list instead of "only 0 teams" (Review Focus 5)', async () => {
    teamsPage0 = [];
    const res = await patch({ draftOrder: [me.id] });
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe("TBA hasn't published 2027 teams yet — usually by January.");
  });
});

describe('GET /api/districts/{year}', () => {
  it('lists districts by name for signed-in users', async () => {
    const res = await getDistricts(request('GET', '/x'), params({ year: '2027' }));
    expect(await readJson(res)).toEqual({ districts: [{ key: '2027fma', name: 'FIRST Mid-Atlantic' }] });
  });
  it('needs sign-in and a sane year', async () => {
    expect((await getDistricts(request('GET', '/x'), params({ year: '20x7' }))).status).toBe(404);
    h.user = null;
    expect((await getDistricts(request('GET', '/x'), params({ year: '2027' }))).status).toBe(401);
  });
});
```

(`insertPick` may need SP4's `auto: false`.)

- [ ] **Step 3: Run them to make sure they fail**

Run: `npx vitest run tests/season/pool.test.ts tests/api/seasonRounds.test.ts`
Expected: FAIL — missing `lib/season/pool.ts`, missing districts route, roster 15 rejected.

- [ ] **Step 4: Write the season team loader**

Create `lib/season/pool.ts`:

```ts
import type { PoolFilter } from '@/lib/season/poolFilter';
import { getTba } from '@/lib/tba/client';
import type { TeamSimple } from '@/lib/tba/types';

const DAY_MS = 24 * 60 * 60_000;
/** TBA pages hold 500 teams; 40 pages is far more than FRC has, and stops a runaway loop. */
const MAX_PAGES = 40;

export function seasonEmptyMessage(year: number): string {
  return `TBA hasn't published ${year} teams yet — usually by January.`;
}

async function allTeams(year: number): Promise<{ teams: TeamSimple[]; stale: boolean }> {
  const teams: TeamSimple[] = [];
  let stale = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await getTba<TeamSimple[]>(`/teams/${year}/${page}/simple`, { windowMs: DAY_MS });
    stale ||= res.stale;
    if (!Array.isArray(res.data) || res.data.length === 0) break;
    teams.push(...res.data);
  }
  return { teams, stale };
}

const same = (a: string | null | undefined, b: string) => (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();

/** The TBA side of a season round's pool (spec §5.5). Manual extra teams are merged by loadPool. */
export async function loadSeasonTbaTeams(year: number, filter: PoolFilter): Promise<{ teams: TeamSimple[]; stale: boolean }> {
  if (filter.type === 'district') {
    const res = await getTba<TeamSimple[]>(`/district/${filter.key}/teams/simple`, { windowMs: DAY_MS });
    return { teams: Array.isArray(res.data) ? res.data : [], stale: res.stale };
  }
  const all = await allTeams(year);
  if (filter.type === 'all') return all;
  return {
    teams: all.teams.filter(
      (t) => same(t.country, filter.country) && (filter.type === 'country' || same(t.state_prov, filter.state)),
    ),
    stale: all.stale,
  };
}
```

- [ ] **Step 5: Add the season branch to `loadPool`**

In `lib/rounds/pool.ts`, change the return type to include `emptyMessage: string | null`, add `emptyMessage: null` to the manual and TBA returns, and add this branch first:

```ts
  if (round.kind === 'season' && round.seasonYear !== null) {
    const [tba, extras] = await Promise.all([
      loadSeasonTbaTeams(round.seasonYear, round.poolFilter ?? DEFAULT_POOL_FILTER),
      getRepo().listExtraTeams(round.id),
    ]);
    const teams = mergePool(tba.teams, extras);
    return {
      teams,
      stale: tba.stale,
      tbaCount: tba.teams.length,
      // Only blame TBA's calendar when TBA actually answered with nothing.
      emptyMessage: teams.length === 0 && !tba.stale ? seasonEmptyMessage(round.seasonYear) : null,
    };
  }
```

(imports: `loadSeasonTbaTeams`, `seasonEmptyMessage` from `@/lib/season/pool`; `DEFAULT_POOL_FILTER` from `@/lib/season/poolFilter`.)

- [ ] **Step 6: Roster 1–15, pool filter and empty message in `PATCH`**

In `app/api/l/[slug]/admin/rounds/[id]/route.ts`:

Replace the `rosterSize` field in `patchSchema` with a type-only check (the range depends on the round's kind) and add `poolFilter`:

```ts
    rosterSize: z.number('Roster size must be a whole number from 1 to 10').optional(),
    poolFilter: poolFilterSchema.optional(),
```

At the top of `PATCH`, after `parseBody`:

```ts
    if (patch.rosterSize !== undefined) {
      const max = round.kind === 'season' ? MAX_SEASON_ROSTER : 10;
      if (!Number.isInteger(patch.rosterSize) || patch.rosterSize < 1 || patch.rosterSize > max) {
        throw new HttpError(400, `Roster size must be a whole number from 1 to ${max}`);
      }
    }
    if (patch.poolFilter !== undefined) {
      if (round.kind !== 'season') throw new HttpError(409, 'Only season rounds have a team pool filter');
      if (round.draftStartedAt || (await repo.listPicks(round.id)).length > 0) {
        throw new HttpError(409, 'Undo all picks to change the team pool');
      }
      if (patch.poolFilter.type === 'district' && !patch.poolFilter.key.startsWith(String(round.seasonYear))) {
        throw new HttpError(400, `Pick a district from the ${round.seasonYear} season`);
      }
    }
    // The size check below must use the filter being saved, not the old one.
    const poolRound = patch.poolFilter ? { ...round, poolFilter: patch.poolFilter } : round;
```

In the existing `P > 0` block, call `loadPool(poolRound, now)` instead of `loadPool(round, now)`, and right after the existing `stale && tbaCount === 0` 503 check add:

```ts
        if (pool.teams.length === 0 && pool.emptyMessage) throw new HttpError(409, pool.emptyMessage);
```

Add `poolFilter: patch.poolFilter,` to the `repo.updateRound` call. (Move `const repo = getRepo();` above the new checks.) Imports: `poolFilterSchema` from `@/lib/season/poolFilter`, `MAX_SEASON_ROSTER` from `@/lib/season/calendar`.

**SP4's draft start** (`app/api/l/[slug]/admin/rounds/[id]/draft/start/route.ts`): where it checks `P × R > T`, add before that check (load the pool with `loadPool(round, now)` if SP4's code only has `buildPoolEntries` there):

```ts
    if (pool.teams.length === 0 && pool.emptyMessage) throw new HttpError(409, pool.emptyMessage);
```

- [ ] **Step 7: Districts route**

Create `app/api/districts/[year]/route.ts`:

```ts
import { handle, HttpError, json } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/session';
import { getTba } from '@/lib/tba/client';
import type { DistrictSimple } from '@/lib/tba/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ year: string }> };

/** Districts for the season pool picker (spec §5.5). Signed-in only: it's for creating/editing leagues. */
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { year } = await ctx.params;
    const y = Number(year);
    if (!/^\d{4}$/.test(year) || y < 1992 || y > 2100) throw new HttpError(404, 'Not found');
    await requireUser();
    const res = await getTba<DistrictSimple[]>(`/districts/${y}`, { windowMs: 24 * 60 * 60_000 });
    const districts = (Array.isArray(res.data) ? res.data : [])
      .filter((d) => d && typeof d.key === 'string')
      .map((d) => ({ key: d.key, name: d.display_name || d.abbreviation.toUpperCase() }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return json({ districts });
  });
}
```

- [ ] **Step 8: Round detail fields**

`lib/api/types.ts` `AdminRoundDetail`: add `poolEmptyMessage: string | null;`.
`lib/rounds/detail.ts`: add `poolEmptyMessage: pool.emptyMessage,` and change the cap:

```ts
    maxRosterSize:
      drafters === 0 ? null : Math.min(round.kind === 'season' ? MAX_SEASON_ROSTER : 10, Math.floor(pool.teams.length / drafters)),
```

- [ ] **Step 9: Write the failing UI test for the filter fields**

Create `tests/ui/poolFilter.test.ts`:

```ts
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PoolFilterFields, poolFilterLabel } from '@/components/PoolFilterFields';

describe('poolFilterLabel', () => {
  it('describes each filter in words', () => {
    expect(poolFilterLabel({ type: 'all' })).toBe('All teams');
    expect(poolFilterLabel({ type: 'district', key: '2027fma' })).toBe('District 2027fma');
    expect(poolFilterLabel({ type: 'state', country: 'USA', state: 'Pennsylvania' })).toBe('Pennsylvania, USA');
    expect(poolFilterLabel({ type: 'country', country: 'Canada' })).toBe('Canada');
  });
});

describe('PoolFilterFields', () => {
  it('shows the right inputs for a state filter', () => {
    const html = renderToStaticMarkup(
      h(PoolFilterFields, { year: 2027, value: { type: 'state', country: 'USA', state: 'Pennsylvania' }, onChange: () => {} }),
    );
    for (const s of ['Which teams', 'Country', 'State or province', 'value="Pennsylvania"']) expect(html).toContain(s);
  });
});
```

- [ ] **Step 10: Write `PoolFilterFields`**

Create `components/PoolFilterFields.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { PoolFilter } from '@/lib/season/poolFilter';

export function poolFilterLabel(f: PoolFilter): string {
  switch (f.type) {
    case 'all':
      return 'All teams';
    case 'district':
      return `District ${f.key}`;
    case 'state':
      return `${f.state}, ${f.country}`;
    case 'country':
      return f.country;
  }
}

/** Controlled fields for a season pool filter (spec §5.5). Used on /leagues/new and in round setup. */
export function PoolFilterFields({
  year,
  value,
  onChange,
  disabled,
}: {
  year: number;
  value: PoolFilter;
  onChange: (f: PoolFilter) => void;
  disabled?: boolean;
}) {
  const [districts, setDistricts] = useState<{ key: string; name: string }[] | null>(null);
  useEffect(() => {
    if (value.type !== 'district') return;
    let cancelled = false;
    setDistricts(null);
    fetch(`/api/districts/${year}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { districts: [] }))
      .then((body: { districts: { key: string; name: string }[] }) => {
        if (!cancelled) setDistricts(body.districts);
      })
      .catch(() => {
        if (!cancelled) setDistricts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [value.type, year]);

  return (
    <div className="space-y-3">
      <Select
        label="Which teams"
        value={value.type}
        disabled={disabled}
        onChange={(e) => {
          const type = e.target.value as PoolFilter['type'];
          if (type === 'all') onChange({ type });
          if (type === 'district') onChange({ type, key: '' });
          if (type === 'state') onChange({ type, country: 'USA', state: '' });
          if (type === 'country') onChange({ type, country: '' });
        }}
      >
        <option value="all">All teams</option>
        <option value="district">One district</option>
        <option value="state">One state or province</option>
        <option value="country">One country</option>
      </Select>
      {value.type === 'district' ? (
        districts === null ? (
          <p className="text-[15px] text-fg-muted">Loading districts…</p>
        ) : districts.length === 0 ? (
          <p className="text-[15px] text-fg-muted">No districts are listed for {year} yet.</p>
        ) : (
          <Select label="District" value={value.key} disabled={disabled} onChange={(e) => onChange({ type: 'district', key: e.target.value })}>
            <option value="">Pick a district</option>
            {districts.map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}
              </option>
            ))}
          </Select>
        )
      ) : null}
      {value.type === 'state' || value.type === 'country' ? (
        <Input
          label="Country"
          value={value.country}
          disabled={disabled}
          maxLength={60}
          hint="As The Blue Alliance writes it, e.g. USA, Canada, Israel"
          onChange={(e) => onChange({ ...value, country: e.target.value })}
        />
      ) : null}
      {value.type === 'state' ? (
        <Input
          label="State or province"
          value={value.state}
          disabled={disabled}
          maxLength={60}
          hint="Full name, e.g. Pennsylvania, Ontario"
          onChange={(e) => onChange({ ...value, state: e.target.value })}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 11: Pool filter and the 15 cap in round setup**

In `components/admin/RoundSetup.tsx`:
- `const maxRoster = round.kind === 'season' ? 15 : 10;` and use it wherever `10` appears in `maxAllowed` and the roster size select/input.
- For season rounds, add a "Team pool" block at the top of the returned `<div>`:

```tsx
      {round.kind === 'season' && round.seasonYear !== null ? (
        <div className="space-y-3">
          <h3 className={SUBHEAD}>Team pool</h3>
          {detail.poolEmptyMessage ? <Alert tone="info">{detail.poolEmptyMessage}</Alert> : null}
          <PoolFilterFields year={round.seasonYear} value={filter} onChange={setFilter} disabled={locked} />
          <Button
            type="button"
            variant="secondary"
            disabled={busy || locked || JSON.stringify(filter) === JSON.stringify(round.poolFilter ?? { type: 'all' })}
            busy={pending === 'pool-filter'}
            onClick={() =>
              go('pool-filter', () => api(`/rounds/${round.id}`, { method: 'PATCH', body: { poolFilter: filter } }), 'Team pool saved.')
            }
          >
            Save team pool
          </Button>
          <p className="text-[13px] text-fg-muted">{detail.pool.length} teams in the pool.</p>
        </div>
      ) : null}
```

with `const [filter, setFilter] = useState<PoolFilter>(round.poolFilter ?? { type: 'all' });` next to the other state (imports: `PoolFilterFields`, `PoolFilter`). Match `go`'s real signature from `usePending` if it differs.

- [ ] **Step 12: Run the tests**

Run: `npx vitest run tests/season tests/api/seasonRounds.test.ts tests/ui/poolFilter.test.ts tests/api/rounds.test.ts`
Expected: PASS

- [ ] **Step 13: Run the gates**

Run: `npm run typecheck && npm test`
Expected: clean, all pass.

Then in `npm run dev`, switch a test season round's draft to SP4's live mode and open the draft room: the pool loads every team for the filter (≈3,500 for "all"), search by number ("5181") and by nickname both work, and the list scrolls smoothly at 360 px. Spec §6.3 makes search required for season pools; if SP4's room lacks it, add it there now.

- [ ] **Step 14: Commit**

```bash
git add lib/season lib/rounds "app/api/l/[slug]/admin/rounds" app/api/districts lib/api/types.ts components tests
git commit -m "feat(sp2): season pools (all/district/state/country), empty-pool message, rosters up to 15

Co-Authored-By: <the session's attribution line>"
```

---

### Task 13: Fetch budget for season pages

**Files:**
- Create: `lib/season/budget.ts`
- Test: `tests/season/budget.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`lib/season/budget.ts`):
  - `type FetchBudget = { run<T>(live: () => Promise<T>, fallback: () => Promise<T>): Promise<T> }`
  - `createFetchBudget(opts: { maxInFlight: number; budgetMs: number; clock?: () => number }): FetchBudget`
  - `SEASON_BUDGET = { maxInFlight: 4, budgetMs: 6_000 }` (spec §5.5)

`run` starts `live` only while the budget lasts and at most `maxInFlight` at a time; once the budget is spent — including for a task still waiting for a slot — it runs `fallback` (the cache-only path) instead.

- [ ] **Step 1: Write the failing tests**

Create `tests/season/budget.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createFetchBudget, SEASON_BUDGET } from '@/lib/season/budget';

/** A promise you resolve by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createFetchBudget', () => {
  it('matches the spec: 4 in flight, 6 seconds', () => {
    expect(SEASON_BUDGET).toEqual({ maxInFlight: 4, budgetMs: 6_000 });
  });

  it('never runs more than maxInFlight live tasks at once', async () => {
    const budget = createFetchBudget({ maxInFlight: 4, budgetMs: 60_000 });
    let inFlight = 0;
    let most = 0;
    const gates = Array.from({ length: 10 }, () => deferred<void>());
    const all = gates.map((g, i) =>
      budget.run(
        async () => {
          inFlight++;
          most = Math.max(most, inFlight);
          await g.promise;
          inFlight--;
          return `live ${i}`;
        },
        async () => `fallback ${i}`,
      ),
    );
    await tick();
    expect(inFlight).toBe(4);
    gates.forEach((g) => g.resolve());
    expect(await Promise.all(all)).toEqual(gates.map((_, i) => `live ${i}`));
    expect(most).toBe(4);
  });

  it('uses the fallback once the budget is spent, even for tasks already waiting (Review Focus 4)', async () => {
    let now = 0;
    const budget = createFetchBudget({ maxInFlight: 1, budgetMs: 6_000, clock: () => now });
    const slow = deferred<string>();
    const first = budget.run(() => slow.promise, async () => 'fallback 1');
    const second = budget.run(async () => 'live 2', async () => 'fallback 2'); // waits for the slot
    now = 6_000; // the budget runs out while the first fetch is still going
    slow.resolve('live 1');
    expect(await first).toBe('live 1'); // a fetch that already started finishes (TBA's own 5 s timeout bounds it)
    expect(await second).toBe('fallback 2');
    expect(await budget.run(async () => 'live 3', async () => 'fallback 3')).toBe('fallback 3');
  });

  it('frees the slot when a live task throws', async () => {
    const budget = createFetchBudget({ maxInFlight: 1, budgetMs: 60_000 });
    await expect(budget.run(async () => { throw new Error('boom'); }, async () => 'x')).rejects.toThrow('boom');
    expect(await budget.run(async () => 'live', async () => 'fallback')).toBe('live');
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/season/budget.test.ts`
Expected: FAIL — `Cannot find module '@/lib/season/budget'`.

- [ ] **Step 3: Write the budget**

Create `lib/season/budget.ts`:

```ts
export type FetchBudget = {
  /** Runs `live` if the budget allows (waiting for a free slot), otherwise `fallback`. */
  run<T>(live: () => Promise<T>, fallback: () => Promise<T>): Promise<T>;
};

/** Spec §5.5: a season page refreshes at most 4 events at once and stops refreshing after 6 seconds. */
export const SEASON_BUDGET = { maxInFlight: 4, budgetMs: 6_000 } as const;

export function createFetchBudget(opts: { maxInFlight: number; budgetMs: number; clock?: () => number }): FetchBudget {
  const clock = opts.clock ?? Date.now;
  const deadline = clock() + opts.budgetMs;
  let inFlight = 0;
  const waiting: (() => void)[] = [];

  const acquire = async () => {
    while (inFlight >= opts.maxInFlight) await new Promise<void>((resolve) => waiting.push(resolve));
    inFlight++;
  };
  const release = () => {
    inFlight--;
    waiting.shift()?.();
  };

  return {
    async run(live, fallback) {
      if (clock() >= deadline) return fallback();
      await acquire();
      try {
        // The budget may have run out while this task waited for a slot.
        return clock() >= deadline ? await fallback() : await live();
      } finally {
        release();
      }
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/season/budget.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/season/budget.ts tests/season/budget.test.ts
git commit -m "feat(sp2): fetch budget for season pages (4 in flight, 6 s)

Co-Authored-By: <the session's attribution line>"
```

---

### Task 14: `scoreSeasonRound` — sum every official event through `getEventScores`

**Files:**
- Create: `lib/season/score.ts`
- Test: `tests/season/score.test.ts`

**Interfaces:**
- Consumes: SP3 `getEventScores(eventKey, config, windowMs) → { scores: EventScores; stale; fetchedAt }` (`lib/scores/eventScores.ts`); `isOfficialEvent`, `SEASON_TIMEZONE` (Task 11); `createFetchBudget`, `SEASON_BUDGET`, `FetchBudget` (Task 13); v1 `cacheWindowFor`, `localDate`, `addDays`, `DEFAULT_WINDOW_MS`, `getTba`.
- Produces (`lib/season/score.ts`):
  - `type SeasonEventScore = { eventKey: string; name: string; startDate: string; endDate: string; total: number; lines: Line[]; stale: boolean }`
  - `type SeasonTeamDetail = { teamKey: string; total: number; events: SeasonEventScore[]; next: { eventKey: string; name: string; startDate: string } | null }`
  - `type SeasonScores = { teams: Map<string, TeamScore>; detail: Record<string, SeasonTeamDetail>; fetchedAt: string | null; stale: boolean }`
  - `scoreSeasonRound(round: RoundRow, teamKeys: string[], now: Date, budget?: FetchBudget): Promise<SeasonScores>`

Rules (spec §5.5): a team's events come from `/team/{key}/events/{year}/simple`; only **official** events count; an event is scored once it is within a day of starting (the same lead v1's `eventPhase` uses), each through `getEventScores` with the **season round's scoring** and a cache window from **that event's** dates (`timezone = America/New_York`, `finalizedAt` = the season round's); an event shared by several drafted teams is scored once. `TeamScore.lines` is every event's lines in date order; `detail` keeps them grouped per event for the round page. "Next" is the team's first official event starting after today.

- [ ] **Step 1: Write the failing tests**

Create `tests/season/score.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
  getEventScores: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));
vi.mock('@/lib/scores/eventScores', () => ({ getEventScores: (...args: unknown[]) => h.getEventScores(...args) }));

import type { RoundRow } from '@/lib/db/types';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import type { EventScores, Line } from '@/lib/scoring/types';
import { createFetchBudget } from '@/lib/season/budget';
import { scoreSeasonRound } from '@/lib/season/score';

const NOW = new Date('2027-03-14T16:00:00.000Z'); // a Sunday of week 2
const round = {
  id: 'r1', kind: 'season', seasonYear: 2027, scoring: DEFAULT_SCORING, finalizedAt: null,
} as unknown as RoundRow;

const ev = (key: string, event_type: number, start: string, end: string) => ({ key, name: `Event ${key}`, event_type, start_date: start, end_date: end });
const TEAM_EVENTS: Record<string, unknown[]> = {
  frc5181: [
    ev('2027paca', 1, '2027-03-05', '2027-03-07'), // week 1, done
    ev('2027pahat', 1, '2027-03-13', '2027-03-15'), // in progress
    ev('2027mrcmp', 2, '2027-04-08', '2027-04-11'), // future
    ev('2027parr', 99, '2027-10-23', '2027-10-23'), // offseason: never counts
  ],
  frc341: [ev('2027pahat', 1, '2027-03-13', '2027-03-15')],
  frc9999: [],
};
const line = (points: number): Line => ({ category: 'qualRecord', label: `Qual record +${points}`, points });
const scoresFor = (byTeam: Record<string, number>): EventScores => ({
  teams: new Map(Object.entries(byTeam).map(([k, p]) => [k, { teamKey: k, total: p, lines: [line(p)] }])),
  qualsComplete: true,
  rpMethod: 'extra_stats',
});
const EVENT_SCORES: Record<string, EventScores> = {
  '2027paca': scoresFor({ frc5181: 41 }),
  '2027pahat': scoresFor({ frc5181: 12, frc341: 30 }),
};

beforeEach(() => {
  h.getTba = vi.fn(async (path: unknown) => {
    const m = /^\/team\/(frc\d+)\/events\/2027\/simple$/.exec(String(path));
    return { data: m ? TEAM_EVENTS[m[1]] ?? [] : null, fetchedAt: '2027-03-14T15:59:00.000Z', stale: false };
  });
  h.getEventScores = vi.fn(async (eventKey: unknown) => ({
    scores: EVENT_SCORES[String(eventKey)] ?? scoresFor({}),
    stale: false,
    fetchedAt: '2027-03-14T15:58:00.000Z',
  }));
});

describe('scoreSeasonRound', () => {
  it('sums a team over its official events that have started, grouped per event', async () => {
    const out = await scoreSeasonRound(round, ['frc5181'], NOW);
    expect(out.teams.get('frc5181')!.total).toBe(53);
    expect(out.detail.frc5181.events.map((e) => [e.eventKey, e.total])).toEqual([
      ['2027paca', 41],
      ['2027pahat', 12],
    ]);
    expect(out.detail.frc5181.next).toEqual({ eventKey: '2027mrcmp', name: 'Event 2027mrcmp', startDate: '2027-04-08' });
    expect(out.teams.get('frc5181')!.lines).toEqual([line(41), line(12)]);
  });

  it('never scores offseason or future events', async () => {
    await scoreSeasonRound(round, ['frc5181'], NOW);
    const scored = vi.mocked(h.getEventScores).mock.calls.map((c) => c[0]);
    expect(scored.sort()).toEqual(['2027paca', '2027pahat']);
  });

  it('scores an event shared by two drafted teams once, with the round scoring', async () => {
    const out = await scoreSeasonRound(round, ['frc5181', 'frc341'], NOW);
    expect(vi.mocked(h.getEventScores).mock.calls.filter((c) => c[0] === '2027pahat')).toHaveLength(1);
    expect(vi.mocked(h.getEventScores).mock.calls[0][1]).toBe(DEFAULT_SCORING);
    expect(out.teams.get('frc341')!.total).toBe(30);
  });

  it("uses each event's own cache window", async () => {
    await scoreSeasonRound(round, ['frc5181'], NOW);
    const windows = Object.fromEntries(vi.mocked(h.getEventScores).mock.calls.map((c) => [c[0], c[2]]));
    expect(windows['2027pahat']).toBe(60_000); // during the event
    expect(windows['2027paca']).toBe(10 * 60_000); // finished, round not final
    await scoreSeasonRound({ ...round, finalizedAt: '2027-05-01T00:00:00.000Z' } as RoundRow, ['frc5181'], NOW);
    expect(vi.mocked(h.getEventScores).mock.calls.at(-1)![2]).toBe(24 * 60 * 60_000);
  });

  it('gives a team with no events 0, no rows and no next event', async () => {
    const out = await scoreSeasonRound(round, ['frc9999'], NOW);
    expect(out.teams.get('frc9999')).toEqual({ teamKey: 'frc9999', total: 0, lines: [] });
    expect(out.detail.frc9999).toEqual({ teamKey: 'frc9999', total: 0, events: [], next: null });
  });

  it('once the budget is spent, reads caches only (infinite window) and marks the page stale (Review Focus 4)', async () => {
    let t = 0;
    const spent = createFetchBudget({ maxInFlight: 4, budgetMs: 0, clock: () => t++ });
    const out = await scoreSeasonRound(round, ['frc5181'], NOW, spent);
    expect(out.stale).toBe(true);
    expect(out.teams.get('frc5181')!.total).toBe(53); // cached data still scores
    for (const c of vi.mocked(h.getEventScores).mock.calls) expect(c[2]).toBe(Number.POSITIVE_INFINITY);
    for (const c of vi.mocked(h.getTba).mock.calls) expect(c[1]).toEqual({ windowMs: Number.POSITIVE_INFINITY });
  });

  it('survives getEventScores throwing: that event counts 0 and the page is stale', async () => {
    h.getEventScores = vi.fn(async () => {
      throw new Error('boom');
    });
    const out = await scoreSeasonRound(round, ['frc5181'], NOW);
    expect(out.teams.get('frc5181')!.total).toBe(0);
    expect(out.stale).toBe(true);
  });

  it('reports the oldest fetch time', async () => {
    const out = await scoreSeasonRound(round, ['frc5181'], NOW);
    expect(out.fetchedAt).toBe('2027-03-14T15:58:00.000Z');
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/season/score.test.ts`
Expected: FAIL — `Cannot find module '@/lib/season/score'`.

- [ ] **Step 3: Write `scoreSeasonRound`**

Create `lib/season/score.ts`:

```ts
import type { RoundRow } from '@/lib/db/types';
import { addDays, cacheWindowFor, DEFAULT_WINDOW_MS, localDate, type RoundTiming } from '@/lib/rounds/status';
import { getEventScores } from '@/lib/scores/eventScores';
import type { EventScores, Line, TeamScore } from '@/lib/scoring/types';
import { createFetchBudget, type FetchBudget, SEASON_BUDGET } from '@/lib/season/budget';
import { isOfficialEvent, SEASON_TIMEZONE } from '@/lib/season/calendar';
import { getTba } from '@/lib/tba/client';
import type { EventSimple } from '@/lib/tba/types';

export type SeasonEventScore = {
  eventKey: string;
  name: string;
  startDate: string;
  endDate: string;
  total: number;
  lines: Line[];
  stale: boolean;
};
export type SeasonTeamDetail = {
  teamKey: string;
  total: number;
  events: SeasonEventScore[];
  next: { eventKey: string; name: string; startDate: string } | null;
};
export type SeasonScores = {
  teams: Map<string, TeamScore>;
  detail: Record<string, SeasonTeamDetail>;
  fetchedAt: string | null;
  stale: boolean;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_ONLY = Number.POSITIVE_INFINITY; // getTba/getEventScores treat any cached row as fresh
const EMPTY: EventScores = { teams: new Map(), qualsComplete: false, rpMethod: 'none' };

type Scored = { scores: EventScores; stale: boolean; fetchedAt: string | null };

/**
 * A season round's score for each drafted team (spec §5.5): the sum over the team's official events
 * of that year, each scored with the round's config through the event_scores cache.
 */
export async function scoreSeasonRound(
  round: RoundRow,
  teamKeys: string[],
  now: Date,
  budget: FetchBudget = createFetchBudget(SEASON_BUDGET),
): Promise<SeasonScores> {
  const year = round.seasonYear!;
  const today = localDate(now, SEASON_TIMEZONE);
  const times: string[] = [];
  let stale = false;
  const note = (r: { stale: boolean; fetchedAt: string | null }) => {
    stale ||= r.stale;
    if (r.fetchedAt) times.push(r.fetchedAt);
  };

  // 1. Each drafted team's official events, in date order.
  const lists = await Promise.all(
    teamKeys.map((key) => {
      const path = `/team/${key}/events/${year}/simple`;
      return budget.run(
        () => getTba<EventSimple[]>(path, { windowMs: DEFAULT_WINDOW_MS }),
        async () => ({ ...(await getTba<EventSimple[]>(path, { windowMs: CACHE_ONLY })), stale: true }),
      );
    }),
  );
  const eventsByTeam = new Map<string, EventSimple[]>();
  const toScore = new Map<string, EventSimple>();
  lists.forEach((list, i) => {
    note(list);
    const official = (Array.isArray(list.data) ? list.data : [])
      .filter((e) => e && isOfficialEvent(e) && DATE_RE.test(e.start_date ?? '') && DATE_RE.test(e.end_date ?? ''))
      .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.key.localeCompare(b.key));
    eventsByTeam.set(teamKeys[i], official);
    // Same one-day lead as v1's eventPhase: an event is scored from the day before it starts.
    for (const e of official) if (e.start_date <= addDays(today, 1)) toScore.set(e.key, e);
  });

  // 2. Score each event once, within the budget.
  const scored = new Map<string, Scored>();
  await Promise.all(
    [...toScore.values()].map(async (e) => {
      const timing: RoundTiming = {
        startDate: e.start_date,
        endDate: e.end_date,
        timezone: SEASON_TIMEZONE, // Event_Simple has no timezone (spec §5.5)
        finalizedAt: round.finalizedAt,
      };
      let result: Scored;
      try {
        result = await budget.run(
          () => getEventScores(e.key, round.scoring, cacheWindowFor(timing, now)),
          async () => ({ ...(await getEventScores(e.key, round.scoring, CACHE_ONLY)), stale: true }),
        );
      } catch (err) {
        console.error(`Season scoring: ${e.key} failed`, err);
        result = { scores: EMPTY, stale: true, fetchedAt: null };
      }
      note(result);
      scored.set(e.key, result);
    }),
  );

  // 3. Per team: per-event rows, a flat TeamScore for scoreRound, and the next event.
  const teams = new Map<string, TeamScore>();
  const detail: Record<string, SeasonTeamDetail> = {};
  for (const teamKey of teamKeys) {
    const events = eventsByTeam.get(teamKey) ?? [];
    const rows: SeasonEventScore[] = events
      .filter((e) => scored.has(e.key))
      .map((e) => {
        const s = scored.get(e.key)!;
        const team = s.scores.teams.get(teamKey);
        return {
          eventKey: e.key,
          name: e.name,
          startDate: e.start_date,
          endDate: e.end_date,
          total: team?.total ?? 0,
          lines: team?.lines ?? [],
          stale: s.stale,
        };
      });
    const upcoming = events.find((e) => e.start_date > today);
    const total = rows.reduce((sum, r) => sum + r.total, 0);
    teams.set(teamKey, { teamKey, total, lines: rows.flatMap((r) => r.lines) });
    detail[teamKey] = {
      teamKey,
      total,
      events: rows,
      next: upcoming ? { eventKey: upcoming.key, name: upcoming.name, startDate: upcoming.start_date } : null,
    };
  }

  return { teams, detail, fetchedAt: times.length > 0 ? times.sort()[0] : null, stale };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/season/score.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Run the gates**

Run: `npm run typecheck && npm test`
Expected: clean, all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/season/score.ts tests/season/score.test.ts
git commit -m "feat(sp2): scoreSeasonRound sums official events through event_scores under a fetch budget

Co-Authored-By: <the session's attribution line>"
```

---

### Task 15: Season rounds on the round and league pages

**Files:**
- Modify: `lib/rounds/scoreSource.ts`, `lib/views/round.ts`, `components/RosterList.tsx`, `app/l/[slug]/r/[roundId]/page.tsx`
- Test: `tests/views/seasonRound.test.ts`, `tests/ui/round-components.test.ts` (append)

**Interfaces:**
- Consumes: `scoreSeasonRound`, `SeasonTeamDetail`, `SeasonEventScore` (Task 14).
- Produces:
  - `RoundScoreSource.season: Record<string, SeasonTeamDetail> | null` and `RoundView.season` (same type; null unless the round is a season round)
  - `scoreSourceFor(round, now, teamKeys: string[] = [])` — season rounds score only the drafted teams
  - `RosterList` accepts `season?: Record<string, SeasonTeamDetail> | null`; `seasonEventLabel(e: SeasonEventScore): string`

- [ ] **Step 1: Write the failing view test**

Create `tests/views/seasonRound.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  scoreSeasonRound: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/season/score', () => ({ scoreSeasonRound: (...args: unknown[]) => h.scoreSeasonRound(...args) }));

import type { Repo } from '@/lib/db/repo';
import { defaultScoring } from '@/lib/scoring/config';
import { loadRoundPage } from '@/lib/views/round';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

const NOW = new Date('2027-03-14T16:00:00.000Z');
let repo: Repo;

beforeEach(() => {
  repo = createMemoryRepo();
  h.repo = repo;
});

describe('a season round page', () => {
  it('scores drafted teams with scoreSeasonRound, keeps team adjustments, and exposes the per-event detail', async () => {
    const { league, commissioner } = await seedLeague(repo, { format: 'season' });
    const round = await repo.createRound({
      leagueId: league.id, eventKey: null, kind: 'season', seasonYear: 2027, eventName: '2027 Season',
      startDate: '2027-03-05', endDate: '2027-04-18', timezone: 'America/New_York', scoring: defaultScoring(), rosterSize: 1,
    });
    await repo.updateRound(round.id, { draftOrder: [commissioner.id] });
    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: commissioner.id, teamKey: 'frc5181' });
    await repo.insertAdjustment({ roundId: round.id, playerId: null, teamKey: 'frc5181', points: 5, reason: 'Spirit' });
    const detail = {
      frc5181: { teamKey: 'frc5181', total: 41, events: [{ eventKey: '2027paca', name: 'Chesapeake', startDate: '2027-03-05', endDate: '2027-03-07', total: 41, lines: [], stale: false }], next: null },
    };
    h.scoreSeasonRound = vi.fn(async () => ({
      teams: new Map([['frc5181', { teamKey: 'frc5181', total: 41, lines: [] }]]),
      detail,
      fetchedAt: '2027-03-14T15:58:00.000Z',
      stale: false,
    }));

    const page = await loadRoundPage(league.slug, round.id, NOW);
    expect(h.scoreSeasonRound).toHaveBeenCalledWith(expect.objectContaining({ id: round.id }), ['frc5181'], NOW);
    expect(page!.view.scores[0].total).toBe(46);
    expect(page!.view.season).toEqual(detail);
    expect(page!.view).toMatchObject({ hasEventData: true, fetchedAt: '2027-03-14T15:58:00.000Z' });
  });
});
```

(`insertPick` may need SP4's `auto: false`.)

- [ ] **Step 2: Write the failing component test**

Append to `tests/ui/round-components.test.ts`:

```ts
describe('RosterList with season detail', () => {
  const scores: PlayerRoundScore[] = [
    {
      playerId: 'p1', name: 'Joey', total: 58, rank: 1, adjustments: [],
      teams: [{ teamKey: 'frc5181', total: 58, lines: [{ category: 'adjustment', label: 'Spirit', points: 5 }] }],
    },
  ];
  const season = {
    frc5181: {
      teamKey: 'frc5181',
      total: 53,
      events: [
        { eventKey: '2027paca', name: 'Chesapeake', startDate: '2027-03-05', endDate: '2027-03-07', total: 41, stale: false,
          lines: [{ category: 'qualRecord' as const, label: 'Qual record 9-3-0', points: 27 }] },
        { eventKey: '2027pahat', name: 'Hatboro-Horsham', startDate: '2027-03-13', endDate: '2027-03-15', total: 12, stale: false, lines: [] },
      ],
      next: { eventKey: '2027mrcmp', name: 'Mid-Atlantic Championship', startDate: '2027-04-08' },
    },
  };
  const t = text(render(h(RosterList, { scores, teamNames: {}, draftInProgress: false, season })));

  it('shows one row per event with its subtotal, then the event lines', () => {
    expect(t).toContain('Mar 5–7, 2027 · Chesapeake');
    expect(t).toContain('+41');
    expect(t).toContain('Qual record 9-3-0');
    expect(t).toContain('Mar 13–15, 2027 · Hatboro-Horsham');
  });

  it('keeps team adjustments and shows the next event', () => {
    expect(t).toContain('Spirit');
    expect(t).toContain('Next: Mid-Atlantic Championship · Apr 8, 2027');
  });
});
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `npx vitest run tests/views/seasonRound.test.ts tests/ui/round-components.test.ts`
Expected: FAIL — the season round goes down the TBA path (`eventKey` null), and `RosterList` ignores `season`.

- [ ] **Step 4: Add the season branch to the dispatcher**

In `lib/rounds/scoreSource.ts`:
- Add `season: Record<string, SeasonTeamDetail> | null;` to `RoundScoreSource`, and `season: null` to the manual and TBA returns.
- Change the signature and add the branch:

```ts
export async function scoreSourceFor(round: RoundRow, now: Date, teamKeys: string[] = []): Promise<RoundScoreSource> {
  if (round.kind === 'season') return seasonSource(round, now, teamKeys);
  if (round.kind === 'manual') return manualSource(round);
  return tbaSource(round, now);
}

async function seasonSource(round: RoundRow, now: Date, teamKeys: string[]): Promise<RoundScoreSource> {
  const s = await scoreSeasonRound(round, teamKeys, now);
  return {
    teams: s.teams,
    // A season spans many events: the page's per-event notes (OPR pending, RP missing) don't apply.
    qualsComplete: true,
    rpMethod: 'none',
    teamNames: {},
    hasEventData: Object.values(s.detail).some((d) => d.events.length > 0),
    hasRankings: false,
    fetchedAt: s.fetchedAt,
    stale: s.stale,
    season: s.detail,
  };
}
```

(imports: `scoreSeasonRound`, `SeasonTeamDetail` from `@/lib/season/score`.)

- [ ] **Step 5: Pass drafted teams and expose `season` in the view**

In `lib/views/round.ts`: add `season: Record<string, SeasonTeamDetail> | null;` to `RoundView`; in `buildRoundView` call

```ts
  const source = await scoreSourceFor(round, now, [...new Set(picks.map((p) => p.teamKey))]);
```

and add `season: source.season,` to the returned view.

- [ ] **Step 6: Season breakdown in `RosterList`**

In `components/RosterList.tsx`:

```tsx
import { formatDateRange } from '@/lib/format';
import type { SeasonEventScore, SeasonTeamDetail } from '@/lib/season/score';

export function seasonEventLabel(e: SeasonEventScore): string {
  return `${formatDateRange(e.startDate, e.endDate)} · ${e.name}`;
}

/** Season rounds (spec §5.5): the team's season total → one row per event → that event's v1 lines. */
function SeasonBreakdown({ detail, adjustments }: { detail: SeasonTeamDetail; adjustments: Line[] }) {
  return (
    <div className="mt-2 space-y-2">
      {detail.events.length === 0 ? (
        <p className="text-[13px] leading-[18px] text-fg-muted">No events yet</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg bg-surface-2 px-3">
          {detail.events.map((e) => {
            const lines = e.lines.filter((l) => l.points !== 0);
            return (
              <li key={e.eventKey}>
                <details className="group/event">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-1.5 text-[15px] leading-[22px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 break-words text-fg">{seasonEventLabel(e)}</span>
                    <span className={`shrink-0 font-semibold tabular-nums ${pointsTone(e.total)}`}>{signed(e.total)}</span>
                  </summary>
                  {lines.length === 0 ? (
                    <p className="pb-2 text-[13px] leading-[18px] text-fg-muted">No points yet</p>
                  ) : (
                    <ul className="divide-y divide-border pb-1 pl-3">
                      {lines.map((line, i) => (
                        <LineItem key={i} line={line} />
                      ))}
                    </ul>
                  )}
                </details>
              </li>
            );
          })}
        </ul>
      )}
      {adjustments.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg bg-surface-2 px-3">
          {adjustments.map((line, i) => (
            <LineItem key={i} line={line} />
          ))}
        </ul>
      ) : null}
      {detail.next ? (
        <p className="text-[13px] leading-[18px] text-fg-muted">
          Next: {detail.next.name} · {formatDateRange(detail.next.startDate, detail.next.startDate)}
        </p>
      ) : null}
    </div>
  );
}
```

Add `season?: Record<string, SeasonTeamDetail> | null;` to `RosterList`'s props, and in the per-team `<li>`, replace the `lines.length === 0 ? … : …` block with:

```tsx
                      {season?.[team.teamKey] ? (
                        <SeasonBreakdown
                          detail={season[team.teamKey]}
                          adjustments={team.lines.filter((l) => l.category === 'adjustment' && l.points !== 0)}
                        />
                      ) : lines.length === 0 ? (
                        <p className="mt-2 text-[13px] leading-[18px] text-fg-muted">No points yet</p>
                      ) : (
                        <ul className="mt-2 divide-y divide-border rounded-lg bg-surface-2 px-3">
                          {lines.map((line, i) => (
                            <LineItem key={i} line={line} />
                          ))}
                        </ul>
                      )}
```

- [ ] **Step 7: Round page wording for season rounds**

In `app/l/[slug]/r/[roundId]/page.tsx`:

```tsx
  const season = round.kind === 'season';
```

- the not-started alert text becomes `manual ? 'No results entered yet' : season ? 'No events yet this season' : 'Event hasn’t started'`;
- `oprPending` and `rpMissing` get `&& !season` (they describe one event);
- `<RosterList … season={view.season} />`;
- the Rosters card hint becomes `season ? 'Tap a player, then a team, to see each event.' : 'Tap a player to see where their points came from.'`.

The status badge needs no change: a season round's dates are the season's (spec §5.5), so v1's `roundStatus` already shows Live from the day before the first official event and Awaiting final after the last.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run tests/views tests/ui/round-components.test.ts`
Expected: PASS

- [ ] **Step 9: Run the gates and look at it**

Run: `npm run typecheck && npm test`
Expected: clean, all pass.

Then with `npm run dev`: create a season league for **2026** (its events are over, so TBA has data), draft two teams by hand in commissioner mode, and open the round page at 360 px in both themes. Each team should expand into per-event rows ("Mar 5–7, 2026 · …"), each expanding into v1 lines; totals must equal the sum of the event rows plus adjustments.

- [ ] **Step 10: Commit**

```bash
git add lib/rounds/scoreSource.ts lib/views/round.ts components/RosterList.tsx "app/l/[slug]/r/[roundId]/page.tsx" tests
git commit -m "feat(sp2): season rounds on the round and league pages with per-event breakdown

Co-Authored-By: <the session's attribution line>"
```

---

### Task 16: Creating a league with a format

**Files:**
- Create: `lib/leagues/formatSetup.ts`
- Modify: `app/api/leagues/route.ts` (SP1's create-league route), `components/CreateLeagueForm.tsx` (the form SP1's `/leagues/new` page renders)
- Test: `tests/leagues/formatSetup.test.ts`, `tests/api/createLeague.test.ts` (append to SP1's create-league route test, or create it)

**Interfaces:**
- Consumes: SP1 `POST /api/leagues` (creates the league and the creator's commissioner `players` row), `setFollows` (Task 2), `syncFollowedEvents` (Task 8), `fetchSeasonDates` (`lib/season/fetchDates.ts`), `defaultSeasonYear`, `allowedSeasonYears`, `seasonRoundName`, `DEFAULT_SEASON_ROSTER`, `SEASON_TIMEZONE` (`lib/season/calendar.ts`, Task 11), `poolFilterSchema`, `DEFAULT_POOL_FILTER` (Task 1), `PoolFilterFields` (Task 12).
- Produces:
  - `formatOptionsSchema` — zod fields merged into SP1's create body: `format?: 'event' | 'season'` (default `'event'`), `followTeams?: number[]` (event, ≤ 3), `seasonYear?: number`, `poolFilter?: PoolFilter` (season)
  - `checkFormatOptions(options: FormatOptions, now: Date): { year: number; filter: PoolFilter } | null` — validates season year / district before anything is written
  - `setUpLeagueFormat(league: LeagueRow, options: FormatOptions, now: Date): Promise<void>` — follows (and a first sync) for event leagues; the season round for season leagues
  - `createSeasonRound(league: LeagueRow, input: { year: number; poolFilter: PoolFilter; rosterSize?: number; draftOrder?: string[] }): Promise<RoundRow>` (reused by Task 17)

- [ ] **Step 1: Write the failing tests**

Create `tests/leagues/formatSetup.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import type { Repo } from '@/lib/db/repo';
import { formatOptionsSchema, setUpLeagueFormat } from '@/lib/leagues/formatSetup';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

const NOW = new Date('2026-10-23T18:00:00.000Z');
let repo: Repo;

beforeEach(() => {
  repo = createMemoryRepo();
  h.repo = repo;
  h.getTba = vi.fn(async (path: unknown) =>
    String(path) === '/events/2027/simple'
      ? { data: [{ key: '2027paca', name: 'x', event_type: 1, start_date: '2027-03-05', end_date: '2027-03-07' }], fetchedAt: 'x', stale: false }
      : { data: [], fetchedAt: 'x', stale: false },
  );
});

describe('formatOptionsSchema', () => {
  const parse = (v: unknown) => formatOptionsSchema.safeParse(v);
  it('defaults to an event league', () => {
    expect(parse({}).data).toEqual({ format: 'event' });
  });
  it('rejects more than 3 follows and junk pool filters', () => {
    expect(parse({ format: 'event', followTeams: [1, 2, 3, 4] }).success).toBe(false);
    expect(parse({ format: 'season', poolFilter: { type: 'planet' } }).success).toBe(false);
  });
});

describe('setUpLeagueFormat', () => {
  it('a season league gets one "{year} Season" round with roster 8, the filter, and TBA calendar dates', async () => {
    const { league } = await seedLeague(repo, { format: 'season' });
    await setUpLeagueFormat(league, { format: 'season', seasonYear: 2027, poolFilter: { type: 'district', key: '2027fma' } }, NOW);
    const rounds = await repo.listRounds(league.id);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({
      kind: 'season', eventKey: null, seasonYear: 2027, eventName: '2027 Season', rosterSize: 8,
      startDate: '2027-03-05', endDate: '2027-03-07', timezone: 'America/New_York',
      poolFilter: { type: 'district', key: '2027fma' },
    });
    expect(rounds[0].scoring).toEqual(league.defaultScoring);
  });

  it('defaults the season year: next year from October on', async () => {
    const { league } = await seedLeague(repo, { format: 'season' });
    await setUpLeagueFormat(league, { format: 'season' }, NOW);
    expect((await repo.listRounds(league.id))[0]).toMatchObject({ seasonYear: 2027, poolFilter: { type: 'all' } });
  });

  it('refuses a season year other than this year or next', async () => {
    const { league } = await seedLeague(repo, { format: 'season' });
    await expect(setUpLeagueFormat(league, { format: 'season', seasonYear: 2029 }, NOW)).rejects.toThrow(
      'Pick the 2026 or 2027 season',
    );
  });

  it('an event league saves its follows', async () => {
    const { league } = await seedLeague(repo);
    await setUpLeagueFormat(league, { format: 'event', followTeams: [5181] }, NOW);
    expect(await repo.listFollows(league.id)).toEqual([5181]);
    expect(await repo.listRounds(league.id)).toEqual([]); // TBA had no events for 5181 here
  });
});
```

In SP1's create-league route test (`tests/api/createLeague.test.ts` or wherever SP1 tests `POST /api/leagues`), append:

```ts
  it('creates a season league with its season round (spec §5.5)', async () => {
    const res = await createLeague(
      request('POST', '/x', { body: { name: 'Season Fam', visibility: 'link', format: 'season', seasonYear: 2027 } }),
    );
    expect(res.status).toBe(201);
    const slug = (await readJson(res)).league.slug;
    const league = (await repo.getLeagueBySlug(slug))!;
    expect(league.format).toBe('season');
    expect((await repo.listRounds(league.id)).map((r) => r.kind)).toEqual(['season']);
  });

  it('rejects an unknown format', async () => {
    const res = await createLeague(request('POST', '/x', { body: { name: 'X', visibility: 'link', format: 'weekly' } }));
    expect(res.status).toBe(400);
  });
```

(use the names SP1's test already uses for the handler, `request`, and the `getTba` mock; make the mock answer `/events/2027/simple` like above.)

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/leagues/formatSetup.test.ts`
Expected: FAIL — `Cannot find module '@/lib/leagues/formatSetup'`.

- [ ] **Step 3: Write the module**

Create `lib/leagues/formatSetup.ts`:

```ts
import { z } from 'zod';
import { HttpError } from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import type { LeagueRow, RoundRow } from '@/lib/db/types';
import { syncFollowedEvents } from '@/lib/follow/sync';
import { MAX_FOLLOWS } from '@/lib/follow/input';
import {
  allowedSeasonYears,
  DEFAULT_SEASON_ROSTER,
  defaultSeasonYear,
  SEASON_TIMEZONE,
  seasonRoundName,
} from '@/lib/season/calendar';
import { fetchSeasonDates } from '@/lib/season/fetchDates';
import { DEFAULT_POOL_FILTER, type PoolFilter, poolFilterSchema } from '@/lib/season/poolFilter';

const TEAM_MSG = 'Team numbers are 1 to 99999';

/** Format fields of POST /api/leagues (spec §4.4, §5). Merged into SP1's body schema. */
export const formatOptionsSchema = z.object({
  format: z.enum(['event', 'season'], 'Format must be event or season').default('event'),
  followTeams: z
    .array(z.number(TEAM_MSG).int(TEAM_MSG).min(1, TEAM_MSG).max(99999, TEAM_MSG))
    .max(MAX_FOLLOWS, `Follow at most ${MAX_FOLLOWS} teams`)
    .refine((t) => new Set(t).size === t.length, 'Each team can only be followed once')
    .optional(),
  seasonYear: z.number('Season year must be a year').int('Season year must be a year').optional(),
  poolFilter: poolFilterSchema.optional(),
});
export type FormatOptions = z.infer<typeof formatOptionsSchema>;

export async function createSeasonRound(
  league: LeagueRow,
  input: { year: number; poolFilter: PoolFilter; rosterSize?: number; draftOrder?: string[] },
): Promise<RoundRow> {
  const dates = await fetchSeasonDates(input.year); // Jan 1 – Dec 31 until TBA publishes the calendar
  return getRepo().createRound({
    leagueId: league.id,
    kind: 'season',
    eventKey: null,
    seasonYear: input.year,
    eventName: seasonRoundName(input.year),
    startDate: dates.startDate,
    endDate: dates.endDate,
    timezone: SEASON_TIMEZONE,
    scoring: structuredClone(league.defaultScoring),
    poolFilter: input.poolFilter,
    rosterSize: input.rosterSize ?? DEFAULT_SEASON_ROSTER,
    draftOrder: input.draftOrder ?? [],
  });
}

/**
 * Checks the season year and district before anything is written, so a bad request never leaves a
 * half-made league. Returns the resolved year and filter for season leagues (null for event leagues).
 */
export function checkFormatOptions(options: FormatOptions, now: Date): { year: number; filter: PoolFilter } | null {
  if (options.format !== 'season') return null;
  const year = options.seasonYear ?? defaultSeasonYear(now);
  const allowed = allowedSeasonYears(now);
  if (!allowed.includes(year)) throw new HttpError(400, `Pick the ${allowed[0]} or ${allowed[1]} season`);
  const filter = options.poolFilter ?? DEFAULT_POOL_FILTER;
  if (filter.type === 'district' && !filter.key.startsWith(String(year))) {
    throw new HttpError(400, `Pick a district from the ${year} season`);
  }
  return { year, filter };
}

/** Runs right after SP1 creates the league (and its commissioner row). */
export async function setUpLeagueFormat(league: LeagueRow, options: FormatOptions, now: Date): Promise<void> {
  const season = checkFormatOptions(options, now);
  if (season) {
    await createSeasonRound(league, { year: season.year, poolFilter: season.filter });
    return;
  }
  if (options.followTeams && options.followTeams.length > 0) {
    await getRepo().setFollows(league.id, options.followTeams);
    await syncFollowedEvents(league, now); // a TBA failure here is fine: the next visit or cron retries
  }
}
```

- [ ] **Step 4: Call it from the create-league route**

In `app/api/leagues/route.ts` (SP1):
- Merge the options into SP1's body schema: `const bodySchema = sp1BodySchema.extend(formatOptionsSchema.shape);` (or add the four fields to SP1's `z.object` directly — keep `strictObject` if SP1 used it).
- Pass `format: body.format` into SP1's `repo.createLeague({...})` call (Task 1 added `NewLeague.format`).
- Right after SP1 creates the league **and** the creator's commissioner row, and before responding:

```ts
    await setUpLeagueFormat(league, body, new Date());
```

- If SP1 handles `?event={key}` / a first TBA round for new leagues, keep that for `format === 'event'` only.
- Call `checkFormatOptions(body, now)` right after `parseBody` and **before** `createLeague`, so a bad season year or district answers 400 without leaving a half-made league.

- [ ] **Step 5: Format choices on the create-league form**

In `components/CreateLeagueForm.tsx` (SP1's form on `/leagues/new`), add below the name/visibility fields:

```tsx
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-fg">How do you want to play?</legend>
        {(
          [
            ['event', 'Event by event', 'Draft before each event. Scores add up across the season.'],
            ['season', 'Full season', 'Draft once. Your teams score at every official event all season.'],
          ] as const
        ).map(([value, title, blurb]) => (
          <label key={value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border p-3 has-checked:border-primary">
            <input type="radio" name="format" value={value} checked={format === value} onChange={() => setFormat(value)} className="mt-1 size-5 accent-primary" />
            <span>
              <span className="block font-semibold text-fg">{title}</span>
              <span className="block text-[13px] text-fg-muted">{blurb}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {format === 'event' ? (
        <Input
          label="Follow teams (optional, up to 3)"
          value={follows}
          onChange={(e) => setFollows(e.target.value)}
          placeholder="5181"
          inputMode="numeric"
          error={followsError}
          hint="Their events become rounds automatically."
        />
      ) : (
        <div className="space-y-3">
          <Select label="Season" value={String(seasonYear)} onChange={(e) => setSeasonYear(Number(e.target.value))}>
            {allowedSeasonYears(new Date()).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
          <PoolFilterFields year={seasonYear} value={poolFilter} onChange={setPoolFilter} />
        </div>
      )}
```

State: `format` (`'event'` default, or `'event'` when `?event=` is present), `follows` (string), `followsError`, `seasonYear` (`defaultSeasonYear(new Date())`), `poolFilter` (`{ type: 'all' }`). On submit, for `event` run `parseFollowInput(follows)` (show its error and stop on `{ error }`) and send `{ …SP1 fields, format, followTeams }`; for `season` send `{ …SP1 fields, format, seasonYear, poolFilter }`. The format can't be changed later — say so under the fieldset: "You can't change this after the league is created."

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/leagues tests/api`
Expected: PASS

- [ ] **Step 7: Run the gates and look at it**

Run: `npm run typecheck && npm test`
Expected: clean, all pass. In `npm run dev`, create one league of each format at 360 px; the season league's admin shows one "2027 Season" round and no Add-round controls.

- [ ] **Step 8: Commit**

```bash
git add lib/leagues app/api/leagues components/CreateLeagueForm.tsx tests
git commit -m "feat(sp2): create event or full-season leagues (follows, season year, pool filter)

Co-Authored-By: <the session's attribution line>"
```

---

### Task 17: "Start next season" and the season-dates cron job

**Files:**
- Create: `app/api/l/[slug]/admin/seasons/route.ts`, `lib/season/next.ts` (pure, safe to import in client components), `lib/season/jobs.ts` (server)
- Modify: `lib/cron/jobs.ts`, `components/admin/AdminDashboard.tsx`
- Test: `tests/api/seasons.test.ts`, `tests/season/jobs.test.ts`

**Interfaces:**
- Consumes: `createSeasonRound` (Task 16), `fetchSeasonDates` (Task 11), `listOpenSeasonRounds` (Task 2), SP3 `DAILY_JOBS`.
- Produces:
  - `POST /api/l/{slug}/admin/seasons` → `201 { round: { id, eventName, seasonYear } }`; 409 when the league isn't a season league, the latest season isn't Final, or next season already exists
  - `nextSeasonYear(rounds: { kind: RoundKind; seasonYear: number | null; status: RoundStatus }[]): number | null` (`lib/season/next.ts`)
  - `nextPoolFilter(filter: PoolFilter | null, year: number): PoolFilter` (`lib/season/next.ts`) — a district filter moves to the same district next year
  - `seasonDatesJob` (`lib/season/jobs.ts`)
  - `DAILY_JOBS` gains `seasonDatesJob`

- [ ] **Step 1: Write the failing tests**

Create `tests/season/jobs.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as unknown,
  getTba: undefined as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import type { Repo } from '@/lib/db/repo';
import { defaultScoring } from '@/lib/scoring/config';
import { seasonDatesJob } from '@/lib/season/jobs';
import { nextPoolFilter, nextSeasonYear } from '@/lib/season/next';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

describe('nextSeasonYear', () => {
  it('offers the next season only once the latest season is Final', () => {
    expect(nextSeasonYear([{ kind: 'season', seasonYear: 2027, status: 'final' }])).toBe(2028);
    expect(nextSeasonYear([{ kind: 'season', seasonYear: 2027, status: 'live' }])).toBeNull();
    expect(
      nextSeasonYear([
        { kind: 'season', seasonYear: 2027, status: 'final' },
        { kind: 'season', seasonYear: 2028, status: 'setup' },
      ]),
    ).toBeNull();
  });
});

describe('nextPoolFilter', () => {
  it('moves a district filter to next year and keeps the others', () => {
    expect(nextPoolFilter({ type: 'district', key: '2027fma' }, 2028)).toEqual({ type: 'district', key: '2028fma' });
    expect(nextPoolFilter({ type: 'country', country: 'Canada' }, 2028)).toEqual({ type: 'country', country: 'Canada' });
    expect(nextPoolFilter(null, 2028)).toEqual({ type: 'all' });
  });
});

describe('seasonDatesJob', () => {
  let repo: Repo;
  beforeEach(() => {
    repo = createMemoryRepo();
    h.repo = repo;
  });

  it('moves open season rounds to the published calendar, and leaves them alone when TBA is down', async () => {
    const { league } = await seedLeague(repo, { format: 'season' });
    const round = await repo.createRound({
      leagueId: league.id, eventKey: null, kind: 'season', seasonYear: 2027, eventName: '2027 Season',
      startDate: '2027-01-01', endDate: '2027-12-31', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    h.getTba = vi.fn(async () => ({ data: null, fetchedAt: null, stale: true }));
    await seasonDatesJob.run(new Date(), Date.now() + 60_000);
    expect((await repo.getRound(round.id))!.startDate).toBe('2027-01-01');

    h.getTba = vi.fn(async () => ({
      data: [{ key: '2027paca', name: 'x', event_type: 1, start_date: '2027-03-05', end_date: '2027-03-07' }],
      fetchedAt: 'x',
      stale: false,
    }));
    await seasonDatesJob.run(new Date(), Date.now() + 60_000);
    expect(await repo.getRound(round.id)).toMatchObject({ startDate: '2027-03-05', endDate: '2027-03-07' });
  });
});
```

Create `tests/api/seasons.test.ts` (start with the mock block from "Test conventions"), then:

```ts
import { POST as startSeason } from '@/app/api/l/[slug]/admin/seasons/route';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, PlayerRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { params, readJson, request, seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;
let me: PlayerRow;
let season: RoundRow;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  h.getTba = vi.fn(async () => ({ data: [], fetchedAt: 'x', stale: false }));
  const seeded = await seedLeague(repo, { format: 'season' });
  league = seeded.league;
  me = seeded.commissioner;
  h.user = seeded.user;
  season = await repo.createRound({
    leagueId: league.id, eventKey: null, kind: 'season', seasonYear: 2027, eventName: '2027 Season',
    startDate: '2027-03-05', endDate: '2027-04-18', timezone: 'America/New_York', scoring: defaultScoring(),
    rosterSize: 10, draftOrder: [], poolFilter: { type: 'district', key: '2027fma' },
  });
  await repo.updateRound(season.id, { draftOrder: [me.id] });
});

const start = () => startSeason(request('POST', '/x'), params({ slug: league.slug }));

describe('POST /admin/seasons', () => {
  it('waits until the current season is Final', async () => {
    const res = await start();
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('Mark the 2027 season final first');
  });

  it('creates next season with the same order, roster size and (moved) district', async () => {
    await repo.updateRound(season.id, { finalizedAt: '2027-05-01T00:00:00.000Z' });
    const res = await start();
    expect(res.status).toBe(201);
    const next = (await repo.listRounds(league.id)).find((r) => r.seasonYear === 2028)!;
    expect(next).toMatchObject({
      kind: 'season', eventName: '2028 Season', rosterSize: 10, draftOrder: [me.id],
      poolFilter: { type: 'district', key: '2028fma' }, startDate: '2028-01-01', endDate: '2028-12-31',
    });
    expect((await start()).status).toBe(409); // 2028 isn't Final yet
  });

  it('is only for season leagues', async () => {
    const eventLeague = await seedLeague(repo, { slug: 'event-fam-abc234' });
    h.user = eventLeague.user;
    const res = await startSeason(request('POST', '/x'), params({ slug: eventLeague.league.slug }));
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('Only full-season leagues have seasons');
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/season/jobs.test.ts tests/api/seasons.test.ts`
Expected: FAIL — missing modules.

- [ ] **Step 3: Write the helpers and the job**

Create `lib/season/next.ts` (no server imports, so the dashboard can use it):

```ts
import type { RoundKind } from '@/lib/db/types';
import type { RoundStatus } from '@/lib/rounds/status';
import { DEFAULT_POOL_FILTER, type PoolFilter } from '@/lib/season/poolFilter';

/** "Start {year + 1} season" shows once the latest season round is Final (spec §5.5). */
export function nextSeasonYear(
  rounds: { kind: RoundKind; seasonYear: number | null; status: RoundStatus }[],
): number | null {
  const seasons = rounds.filter((r) => r.kind === 'season' && r.seasonYear !== null);
  if (seasons.length === 0) return null;
  const latest = seasons.reduce((a, b) => (b.seasonYear! > a.seasonYear! ? b : a));
  return latest.status === 'final' ? latest.seasonYear! + 1 : null;
}

/** District keys carry their year (2027fma); the same district next season is 2028fma. */
export function nextPoolFilter(filter: PoolFilter | null, year: number): PoolFilter {
  if (!filter) return DEFAULT_POOL_FILTER;
  return filter.type === 'district' ? { type: 'district', key: `${year}${filter.key.slice(4)}` } : filter;
}
```

Create `lib/season/jobs.ts`:

```ts
import { getRepo } from '@/lib/db';
import { fetchSeasonDates } from '@/lib/season/fetchDates';

/** Daily cron job (spec §5.5): keep open season rounds' dates on TBA's official calendar. */
export const seasonDatesJob = {
  name: 'season-dates',
  async run(_now: Date, deadline: number): Promise<void> {
    const repo = getRepo();
    const byYear = new Map<number, Awaited<ReturnType<typeof fetchSeasonDates>>>();
    for (const round of await repo.listOpenSeasonRounds()) {
      if (Date.now() >= deadline) break;
      if (round.seasonYear === null) continue;
      if (!byYear.has(round.seasonYear)) byYear.set(round.seasonYear, await fetchSeasonDates(round.seasonYear));
      const dates = byYear.get(round.seasonYear)!;
      // TBA down: keep what we have rather than falling back to Jan 1 – Dec 31.
      if (dates.stale) continue;
      if (dates.startDate !== round.startDate || dates.endDate !== round.endDate) {
        await repo.updateRound(round.id, { startDate: dates.startDate, endDate: dates.endDate });
      }
    }
  },
};
```

In `lib/cron/jobs.ts`, append `seasonDatesJob` to `DAILY_JOBS` after `followSyncJob`.

- [ ] **Step 4: Write the route**

Create `app/api/l/[slug]/admin/seasons/route.ts`:

```ts
import { handle, HttpError, json } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { createSeasonRound } from '@/lib/leagues/formatSetup';
import { nextPoolFilter } from '@/lib/season/next';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string }> };

/** "Start {year + 1} season" (spec §5.5): copies the draft order (linked players), roster size and pool. */
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    if (league.format !== 'season') throw new HttpError(409, 'Only full-season leagues have seasons');
    const repo = getRepo();
    const [rounds, players] = await Promise.all([repo.listRounds(league.id), repo.listPlayers(league.id)]);
    const seasons = rounds.filter((r) => r.kind === 'season' && r.seasonYear !== null);
    if (seasons.length === 0) throw new HttpError(409, 'This league has no season yet');
    const latest = seasons.reduce((a, b) => (b.seasonYear! > a.seasonYear! ? b : a));
    if (!latest.finalizedAt) throw new HttpError(409, `Mark the ${latest.seasonYear} season final first`);

    const year = latest.seasonYear! + 1;
    const linked = new Set(players.filter((p) => p.userId !== null).map((p) => p.id));
    const round = await createSeasonRound(league, {
      year,
      poolFilter: nextPoolFilter(latest.poolFilter, year),
      rosterSize: latest.rosterSize,
      draftOrder: latest.draftOrder.filter((id) => linked.has(id)),
    });
    return json({ round: { id: round.id, eventName: round.eventName, seasonYear: round.seasonYear } }, 201);
  });
}
```

- [ ] **Step 5: The button on the dashboard**

In `components/admin/AdminDashboard.tsx`, inside the Rounds card, when `state.league.format === 'season'`:

```tsx
          {state.league.format === 'season' ? (
            (() => {
              const next = nextSeasonYear(state.rounds);
              return next === null ? (
                <p className="text-[13px] leading-[18px] text-fg-muted">
                  Full-season leagues have one round per season. Mark this season final to start the next one.
                </p>
              ) : (
                <Button
                  type="button"
                  variant="accent"
                  busy={pending === 'next-season'}
                  disabled={busy}
                  onClick={() => run('next-season', () => api('/seasons', { method: 'POST' }), `Started the ${next} season.`)}
                >
                  Start {next} season
                </Button>
              );
            })()
          ) : null}
```

(import `nextSeasonYear` from `@/lib/season/next`.)

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/season tests/api/seasons.test.ts`
Expected: PASS

- [ ] **Step 7: Run the gates**

Run: `npm run typecheck && npm test`
Expected: clean, all pass.

- [ ] **Step 8: Commit**

```bash
git add "app/api/l/[slug]/admin/seasons" lib/season/next.ts lib/season/jobs.ts lib/cron/jobs.ts components/admin/AdminDashboard.tsx tests
git commit -m "feat(sp2): start next season, and keep season dates on TBA's calendar daily

Co-Authored-By: <the session's attribution line>"
```

---

### Task 18: Me tab — which event a season pick is at

**Files:**
- Create: `lib/season/current.ts`
- Modify: SP1's Me-tab loader (the code that builds the "Live now / Up next" card — find it with `grep -rln "Up next" lib app`)
- Test: `tests/season/current.test.ts`

**Interfaces:**
- Consumes: `EventSimple`, `isOfficialEvent`, `SEASON_TIMEZONE`; v1 `localDate`, `addDays`, `getTba`, `DEFAULT_WINDOW_MS`.
- Produces (`lib/season/current.ts`):
  - `seasonCurrentEvent(events: EventSimple[], today: string): { kind: 'current'; event: EventSimple } | { kind: 'next'; event: EventSimple } | null`
  - `pickEventForMe(round: RoundRow, teamKey: string, now: Date): Promise<{ kind: 'event'; eventKey: string } | { kind: 'next'; name: string; startDate: string } | null>`

Spec §4.6: for season rounds (Live for months), the "current event" is the team's **official** event whose dates contain today (±1 day); if none, show "Next: {event} · {date}"; teams with no event in the next 7 days are omitted. TBA rounds use their own event; manual rounds have no TBA matches and are left out of the card.

- [ ] **Step 1: Write the failing tests**

Create `tests/season/current.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getTba: undefined as unknown as (...args: unknown[]) => unknown }));
vi.mock('@/lib/tba/client', () => ({ getTba: (...args: unknown[]) => h.getTba(...args) }));

import type { RoundRow } from '@/lib/db/types';
import { pickEventForMe, seasonCurrentEvent } from '@/lib/season/current';
import type { EventSimple } from '@/lib/tba/types';

const ev = (key: string, event_type: number, start: string, end = start): EventSimple => ({
  key, name: `Event ${key}`, event_type, start_date: start, end_date: end,
});
const EVENTS = [ev('2027paca', 1, '2027-03-05', '2027-03-07'), ev('2027mrcmp', 2, '2027-04-08', '2027-04-11'), ev('2027off', 99, '2027-03-20')];

describe('seasonCurrentEvent', () => {
  it('finds the event whose dates contain today, with a day either side', () => {
    expect(seasonCurrentEvent(EVENTS, '2027-03-04')).toEqual({ kind: 'current', event: EVENTS[0] });
    expect(seasonCurrentEvent(EVENTS, '2027-03-08')).toEqual({ kind: 'current', event: EVENTS[0] });
  });
  it('otherwise gives the next official event within 7 days', () => {
    expect(seasonCurrentEvent(EVENTS, '2027-04-01')).toEqual({ kind: 'next', event: EVENTS[1] });
  });
  it('omits teams with nothing in the next 7 days, and ignores offseason events', () => {
    expect(seasonCurrentEvent(EVENTS, '2027-03-15')).toBeNull(); // 2027off is 5 days away but offseason
    expect(seasonCurrentEvent(EVENTS, '2027-03-31')).toBeNull(); // mrcmp is 8 days away
  });
});

describe('pickEventForMe', () => {
  beforeEach(() => {
    h.getTba = vi.fn(async () => ({ data: EVENTS, fetchedAt: 'x', stale: false }));
  });
  const NOW = new Date('2027-03-06T16:00:00.000Z');

  it('uses a TBA round’s own event and skips manual rounds', async () => {
    expect(await pickEventForMe({ kind: 'tba', eventKey: '2026parr' } as RoundRow, 'frc5181', NOW)).toEqual({ kind: 'event', eventKey: '2026parr' });
    expect(await pickEventForMe({ kind: 'manual', eventKey: null } as RoundRow, 'frc5181', NOW)).toBeNull();
    expect(h.getTba).not.toHaveBeenCalled();
  });

  it('finds a season pick’s current or next event', async () => {
    const round = { kind: 'season', seasonYear: 2027 } as RoundRow;
    expect(await pickEventForMe(round, 'frc5181', NOW)).toEqual({ kind: 'event', eventKey: '2027paca' });
    expect(await pickEventForMe(round, 'frc5181', new Date('2027-04-02T16:00:00.000Z'))).toEqual({
      kind: 'next', name: 'Event 2027mrcmp', startDate: '2027-04-08',
    });
    expect(h.getTba).toHaveBeenCalledWith('/team/frc5181/events/2027/simple', expect.anything());
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/season/current.test.ts`
Expected: FAIL — `Cannot find module '@/lib/season/current'`.

- [ ] **Step 3: Write the module**

Create `lib/season/current.ts`:

```ts
import type { RoundRow } from '@/lib/db/types';
import { addDays, DEFAULT_WINDOW_MS, localDate } from '@/lib/rounds/status';
import { isOfficialEvent, SEASON_TIMEZONE } from '@/lib/season/calendar';
import { getTba } from '@/lib/tba/client';
import type { EventSimple } from '@/lib/tba/types';

/** Spec §4.6: the official event covering today (±1 day), else the next one within 7 days, else nothing. */
export function seasonCurrentEvent(
  events: EventSimple[],
  today: string,
): { kind: 'current'; event: EventSimple } | { kind: 'next'; event: EventSimple } | null {
  const official = events
    .filter((e) => e && isOfficialEvent(e))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const current = official.find((e) => addDays(e.start_date, -1) <= today && today <= addDays(e.end_date, 1));
  if (current) return { kind: 'current', event: current };
  const next = official.find((e) => e.start_date > today);
  return next && next.start_date <= addDays(today, 7) ? { kind: 'next', event: next } : null;
}

/** Which event the Me tab's "Live now / Up next" card should look at for one drafted team. */
export async function pickEventForMe(
  round: RoundRow,
  teamKey: string,
  now: Date,
): Promise<{ kind: 'event'; eventKey: string } | { kind: 'next'; name: string; startDate: string } | null> {
  if (round.kind === 'tba') return round.eventKey ? { kind: 'event', eventKey: round.eventKey } : null;
  if (round.kind !== 'season' || round.seasonYear === null) return null; // manual: no TBA matches to show
  const res = await getTba<EventSimple[]>(`/team/${teamKey}/events/${round.seasonYear}/simple`, {
    windowMs: DEFAULT_WINDOW_MS,
  });
  const found = seasonCurrentEvent(Array.isArray(res.data) ? res.data : [], localDate(now, SEASON_TIMEZONE));
  if (!found) return null;
  return found.kind === 'current'
    ? { kind: 'event', eventKey: found.event.key }
    : { kind: 'next', name: found.event.name, startDate: found.event.start_date };
}
```

- [ ] **Step 4: Use it in SP1's Me-tab loader**

In SP1's loader for the "Live now / Up next" card, where each pick is turned into a row using its round's event key, call `pickEventForMe(round, pick.teamKey, now)` instead of reading `round.eventKey` directly:
- `{ kind: 'event', eventKey }` → build the row exactly as SP1 does for a TBA round ("Q14 · up next" / "in 2 matches" / "Eliminated" / "Done") using that event key;
- `{ kind: 'next', name, startDate }` → a row reading `Next: {name} · {formatDateRange(startDate, startDate)}`;
- `null` → no row for this pick.

Also include **season** rounds when SP1 filters rounds to "Live or Upcoming within 7 days" (a season round is Live for months, so the filter already includes it once its dates are set). Add a test to SP1's Me-tab loader test file: a season pick whose team is at an event today produces the same row shape as a TBA pick at that event, and one with nothing in the next 7 days produces no row.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/season/current.test.ts` and SP1's Me-tab test file.
Expected: PASS

- [ ] **Step 6: Run the gates**

Run: `npm run typecheck && npm test`
Expected: clean, all pass.

- [ ] **Step 7: Commit**

```bash
git add lib/season/current.ts lib app tests
git commit -m "feat(sp2): Me tab shows a season pick's current or next official event

Co-Authored-By: <the session's attribution line>"
```

---

### Task 19: Docs

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-09-29-frc-fantasy-design.md` (§13 backlog note only)

- [ ] **Step 1: README**

Add a "League formats" section:
- **Event by event** — one round per event. Add a round from a TBA event key, or a **Manual event** (for events not on TBA: add teams by number, then type results into the round's **Results** card; no OPR bonus).
- **Follow teams** — up to 3 team numbers in the admin Rounds card; their events this year are added as rounds automatically (daily at 10:00 UTC and whenever the league page is opened, at most every 10 minutes). Deleting an auto-added round keeps it deleted.
- **Full season** — draft once; teams score at every official event (regionals, districts, district champs, Champs) that year. Pool: all teams, one district, one state/province, or one country. Rosters up to 15 (default 8). "Start {next year} season" appears once the season is marked final.

In the cron section (SP3 added it), list the three daily jobs: `team_stats`, `follow-sync`, `season-dates`.

- [ ] **Step 2: CLAUDE.md**

Under "Locked decisions", replace the **Format** bullet with:

```md
- **Formats (v2):** two league types, fixed at creation — **event-by-event** (TBA or manual rounds; optional follow up to 3 teams → automatic rounds) and **full season** (draft once, score every official event; pool all / district / state / country). v1 leagues are event-by-event.
```

Under "Current status", note that v2 SP2 (formats) shipped with migration `0005_formats.sql`.

- [ ] **Step 3: v1 spec backlog**

In `docs/superpowers/specs/2026-09-29-frc-fantasy-design.md` §13, next to the full-season / manual events backlog item (if listed), add "— done in v2 (SP2)".

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md docs/superpowers/specs/2026-09-29-frc-fantasy-design.md
git commit -m "docs(sp2): league formats, follow teams, full season

Co-Authored-By: <the session's attribution line>"
```

---

### Task 20: Merge, migrate production, deploy check

**Files:** none new. This task ships SP2. **Stop and get Joey's "go" before Step 3** (it changes the production database).

- [ ] **Step 1: Final gates on the branch**

Run: `npm run typecheck && npm test && npm run build`
Expected: clean typecheck; every test passes (write the new count in the PR); the build succeeds.

- [ ] **Step 2: Open the PR**

Push the branch and open a PR titled `SP2: league formats (manual events, follow-a-team, full season)`. The body lists: migration `0005_formats.sql`; the three spec deviations at the top of this plan; the test count; screenshots at 360 px (dark and light) of the Results card, a season round's per-event breakdown, and the create-league format choice. End the body with the attribution line from the session's instructions.

- [ ] **Step 3: Apply migration `0005` to production (after Joey's go)**

1. Wake the Supabase project if it's paused.
2. In the Supabase SQL editor, confirm the roster check's name first:
   `select conname from pg_constraint where conrelid = 'rounds'::regclass and contype = 'c';`
   It must list `rounds_roster_size_check`. If it shows a different name, edit that one line of `0005_formats.sql` (`drop constraint if exists <real name>`) and commit before running.
3. Run the whole of `supabase/migrations/0005_formats.sql` in the SQL editor.
4. Check: `select column_name from information_schema.columns where table_name = 'rounds' and column_name in ('kind','season_year','pool_filter','auto_added');` returns 4 rows, and `select relname, relrowsecurity from pg_class where relname in ('manual_results','league_follows','league_skipped_events');` shows `true` for all three.
5. Run SP4's `scripts/smoke-v2.ts` against the dev project (its RLS check covers every `public` table, including the three new ones).

- [ ] **Step 4: Merge and deploy check**

Merge the PR (Vercel deploys `main`). On the live site:
- The family league (event format) still shows its rounds and standings; its Ramp Riot round is unchanged.
- In the admin, add a manual event, add two teams, type one result → the public round page shows the points.
- Set "Follow teams" to 5181 → any upcoming 5181 events appear as rounds marked "Auto-added · following 5181"; delete one, reload the league page twice (more than 10 minutes apart, or trigger `GET /api/cron/daily` with the bearer secret) → it doesn't come back.
- Create a throwaway full-season league for 2026 → one "2026 Season" round with official-event dates; draft two teams in commissioner mode → the round page shows per-event rows. Delete the throwaway league afterwards.
- In Vercel → Cron Jobs, the daily job shows the schedule `0 10 * * *`; run it once and check the function log lists `team_stats`, `follow-sync` and `season-dates` with no errors.

- [ ] **Step 5: Wrap up**

Update `CLAUDE.md` "Current status" with the merge date, and note that migration `0006_cleanup.sql` (drop `leagues.admin_token_hash`, `leagues.home_team_number`) is next, after Ramp Riot (spec §8.2). Commit and push to `main`.
