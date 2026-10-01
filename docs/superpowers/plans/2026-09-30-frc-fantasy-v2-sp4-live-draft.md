# FRC Fantasy v2 — SP4 Live Draft Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every member of a league draft from their own phone in real time — with a commissioner-set pick timer, auto-pick on timeout, "auto-draft me", a personal draft queue, and commissioner pause/undo/pick-for — while commissioner-entered drafts keep working exactly as in v1.

**Architecture:** A round gets a `draft_mode` (`commissioner` | `live`). Live-mode picks, undos, and start/pause/resume go through three Postgres functions that lock the round row, so racing phones get a clean "someone beat you" instead of a corrupt draft. All "what happens next" logic is pure (`lib/draft/live.ts`) and one server routine (`advance`) runs after every state change to auto-pick for auto-drafters. After every change the server "rings a doorbell" (an empty Supabase Realtime Broadcast); phones refetch `GET …/draft/state`, with polling as a fallback and a client-side rate limit.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript strict, Tailwind 4, Supabase Postgres (plpgsql functions via `supabase.rpc`) + Realtime Broadcast (`@supabase/supabase-js` 2 channel API; REST `POST /realtime/v1/api/broadcast`), zod 4, Vitest 5, Playwright (new, E2E only).

**Spec:** `docs/superpowers/specs/2026-09-30-frc-fantasy-v2-design.md` — this plan implements §7 (live draft room), the SP4 parts of §6.3 (pool endpoint + pool UI with stats shown as "New"), §8.1 (RPC lockdown, RLS check), §8.2 (`0003_live_draft.sql`), and §9 (E2E + real-database smoke). Plan index and cross-plan contract: `docs/superpowers/plans/2026-09-30-frc-fantasy-v2.md`.

**Built second**, right after SP1. SP1's names (contract "From SP1") already exist: `getUser`/`requireUser` (`lib/auth/session.ts`), `requireLeagueRole`/`requireLeagueView` (`lib/auth/roles.ts`), `PlayerRow.userId/role`, `Repo.createMember`/`getMemberByUser`, `createBrowserSupabase` (`lib/supabase/browser.ts`), `seedLeague(repo)` returning `{ league, commissioner, user }`, `request()` without a token, and the E2E-only `/api/test/login` route. SP3 and SP2 do not exist yet.

## Global Constraints

All constraints in `docs/superpowers/plans/2026-09-30-frc-fantasy-v2.md` apply. SP4-specific values, copied from the spec:

- Pick timer values: **off / 30 / 60 / 90 / 120 s** (`pick_seconds in (30, 60, 90, 120)`, `null` = no timer). Commissioner sets it; `draftMode` changes only before start; `pickSeconds` changes before start or while paused (§7.3).
- `draft_make_pick(p_round_id, p_pick_number, p_player_id, p_team_key, p_require_due boolean, p_auto boolean) returns boolean` and `draft_undo_pick(p_round_id, p_pick_number) returns boolean` — lock the round row `for update`, return `false` (never raise) when a check fails (§7.2). `p_pick_number` is 0-based.
- Pick 409 codes: `not_your_turn` / `stale` / `taken` / `not_live`; 400 when the team isn't in the pool (§7.3). The JSON body is `{ error: string, code?: string }`.
- Queue: `PUT …/draft/queue { teamKeys: string[] }` — **≤ 100**, all in the pool, no duplicates; replaces the whole queue.
- Auto-pick: queue first (first still-available team), else highest `proj`; ties and "New" (`proj = null`) teams go by lowest team number, after all projected teams (§7.4). In SP4 every `proj` is `null`.
- Timeout: a client calls `tick` once its corrected clock passes **`deadline + 500 ms`**, and retries **every 2 s** while overdue. The server passes `p_require_due = true`, so the database clock decides.
- `advance(roundId)` runs after **start, every pick (player, commissioner, `tick`), resume, undo, and auto-draft turned on** (§7.4).
- Undoing an **auto-pick** sets that player's `autodraft = false` (§7.3).
- Pause: `paused_remaining_ms = max(0, pick_deadline − now())`, `pick_deadline = null`. Resume: `pick_deadline = now() + max(paused_remaining_ms, 10 s)`; if `pick_seconds` changed while paused, the full new `pick_seconds` (§7.1).
- Doorbell: topic `draft:{roundId}`, event `changed`, **empty payload**, via `POST {SUPABASE_URL}/realtime/v1/api/broadcast` with the service key; failures are logged and ignored (§7.5).
- Client refetch: debounce **250 ms**, at most **one per 1.5 s**, a ring during an in-flight fetch schedules exactly one follow-up (§7.5).
- Polling fallback: every **3 s** while the channel isn't `SUBSCRIBED`, every **15 s** while it is, and immediately when the tab becomes visible (§7.5).
- Clock sync: `offset = serverNow − (receivedAt − rtt/2)`; `remaining = deadline − (Date.now() + offset)` (§7.5).
- Banner copy (§7.6): "On the clock: Mom · 0:42" (timer red under **10 s**) / "You're up in 2 picks" / "Paused by commissioner" / "Draft complete". Your turn: tab title flashes **"Your pick!"** and `navigator.vibrate(200)` fires once. Confirm sheet: "Draft 341 · Proj 38.2?" (SP4: "Draft 341?" because `proj` is null). Errors: `taken` → "341 was just taken — pick again"; `stale`/`not_your_turn` → silent refetch; network loss → "Reconnecting…" banner while the local countdown continues.
- Members interact; non-members of `link` leagues watch read-only; `members` leagues show the private card (§7.6). Signed-in members see "Draft is live — join" on the league and round pages while the phase is `live` or `paused`.
- Commissioner-mode rounds keep the v1 draft entry screen and v1 behavior unchanged.

## Deviations from the spec (flagged for Joey)

1. **Start / pause / resume use a third locked function, `draft_control(p_round_id, p_action)`**, instead of "one SQL statement each without an RPC" (§7.1). Reason: PostgREST can't express `now()` or `greatest(…)` in an `update`, so without a function the app server's clock would compute deadlines while `draft_make_pick` uses the database clock. One function keeps a single clock and the same row lock. Contract addition: `Repo.draftControl(roundId, action: 'start' | 'pause' | 'resume'): Promise<boolean>`.
2. **A helper SQL function `public_tables_without_rls()`** (service role only) lets `scripts/smoke-v2.ts` do the §8.1 RLS-on check through PostgREST, which can't read `pg_class` directly.
3. **`HttpError` gains an optional `code`**, and `handle()` adds it to the JSON body, so the client can tell `taken` from `stale` (§7.3 names the codes but not the transport).

## Review Focus

Inputs the spec implies but no happy-path test exercises, most likely to bite first. Each is pinned by a test in the named task.

1. **Two phones draft the same pick at the same instant** (same `expectedPickNumber`, same or different team) → exactly one pick saved; the other gets 409 `taken` or `stale`, never a 500. *Pinned in Task 3 (memory repo) and Task 16 (real database race).*
2. **The first picker has auto-draft on when the commissioner presses Start** (timer off) → their pick happens at once and the draft moves on; same after resume and after undo. *Pinned in Task 6.*
3. **Commissioner pauses after the clock already ran out, then resumes** → the player gets 10 seconds, not an instant auto-pick. *Pinned in Task 2 (math) and Task 3 (repo emulation).*
4. **A `tick` arrives before the deadline** (a phone whose clock runs fast) → nothing is picked (`{ picked: false }`); the database clock decides. *Pinned in Task 8.*
5. **Commissioner undoes an auto-pick while that player is still on auto-draft** → the pick is removed and stays removed (auto-draft switched off for that player), and the deadline restarts. *Pinned in Task 11 (route) and Task 17 (E2E).*

## File Structure

```
supabase/migrations/0003_live_draft.sql      round draft columns, picks.auto, draft_queue, draft_prefs,
                                             draft_make_pick, draft_undo_pick, draft_control,
                                             public_tables_without_rls (Task 1)
lib/db/types.ts                              RoundRow draft fields, PickRow.auto (Task 1)
lib/db/repo.ts                               RoundPatch draft fields; live-draft Repo methods (Tasks 1, 3)
lib/db/supabaseRepo.ts                       mappers + rpc calls (Tasks 1, 3)
tests/helpers/memoryRepo.ts                  emulates the three functions with an injectable clock (Tasks 1, 3)
lib/draft/live.ts                            pure: phase, on-clock, picks-until-turn, deadlines,
                                             pause/resume math, chooseAutoPick, clock offset (Task 2)
lib/rounds/status.ts                         roundStatus → 'drafting' once a live draft starts (Task 2)
lib/api/http.ts                              HttpError.code → JSON body (Task 4)
lib/draft/errors.ts                          409 codes + classifyFailedPick (Task 4)
lib/realtime/doorbell.ts                     ring(roundId), draftTopic, DOORBELL_EVENT (Task 4)
lib/pool/entries.ts                          PoolEntry, PoolStatsLookup, noPoolStats, activePoolStats,
                                             buildPoolEntries (Task 5)
app/api/l/[slug]/rounds/[id]/pool/route.ts   GET pool (Task 5)
tests/helpers/draftMocks.ts, tests/helpers/draft.ts   shared route-test mocks + seedLiveDraft (Task 5)
lib/draft/advance.ts                         advance(roundId, now) (Task 6)
lib/draft/state.ts                           DraftState, loadDraftState (Task 7)
app/api/l/[slug]/rounds/[id]/draft/state/route.ts      GET state (Task 7)
app/api/l/[slug]/rounds/[id]/draft/pick/route.ts       POST pick (Task 8)
app/api/l/[slug]/rounds/[id]/draft/tick/route.ts       POST tick (Task 8)
app/api/l/[slug]/rounds/[id]/draft/queue/route.ts      PUT queue (Task 9)
app/api/l/[slug]/rounds/[id]/draft/autodraft/route.ts  PUT autodraft (Task 9)
app/api/l/[slug]/admin/rounds/[id]/route.ts            PATCH draftMode / pickSeconds; order lock (Task 10)
app/api/l/[slug]/admin/rounds/[id]/draft/[action]/route.ts  POST start | pause | resume (Task 10)
app/api/l/[slug]/admin/rounds/[id]/picks/route.ts            live mode → draft_make_pick (Task 11)
app/api/l/[slug]/admin/rounds/[id]/picks/[pickNumber]/route.ts  live undo → draft_undo_pick (Task 11)
lib/draft/client.ts                          browser-safe: createRefetcher, shouldTick, pollIntervalMs,
                                             formatClock, titleFrame (Task 12)
lib/draft/poolView.ts                        filterSortPool (Task 12)
lib/draft/api.ts                             browser fetch wrapper for draft endpoints (Task 12)
components/draft/DraftRoomBanner.tsx         sticky banner + bannerLines (Task 13)
components/draft/PoolList.tsx                pool rows, sort/search/filter (Task 13)
components/draft/QueueList.tsx               my queue with up/down/remove (Task 13)
components/draft/ConfirmSheet.tsx            "Draft 341?" (Task 13)
components/draft/DraftRosters.tsx            teams per player (Task 13)
components/DraftBoard.tsx                    optional highlightPick prop (Task 13)
components/draft/useDraftRoom.ts             Realtime + polling + clock sync + tick loop + title flash (Task 14)
components/draft/DraftRoom.tsx               tabs, options menu, actions (Task 14)
app/l/[slug]/r/[roundId]/draft/page.tsx      the draft room page (Task 14)
lib/draft/liveBanner.ts                      liveDraftsOf, memberLiveDrafts (Task 15)
components/draft/LiveDraftBanner.tsx         "Draft is live — join" (Task 15)
app/l/[slug]/page.tsx, app/l/[slug]/r/[roundId]/page.tsx   show LiveDraftBanner (Task 15)
lib/api/types.ts, lib/rounds/detail.ts       AdminRoundDetail draft fields + draftPhase (Task 15)
components/admin/LiveDraftControls.tsx       mode/timer selects, Start/Pause/Resume, room link (Task 15)
components/admin/RoundAdmin.tsx              renders LiveDraftControls (Task 15)
scripts/smoke-v2.ts                          real-database races + RLS/anon lockdown (Task 16)
playwright.config.ts, e2e/helpers.ts, e2e/live-draft.spec.ts   E2E (Task 17)
README.md, CLAUDE.md                         docs (Task 18)
                                             merge + production rehearsal (Task 19)
```

**Why this shape:** everything that decides *what should happen* lives in pure functions (`lib/draft/live.ts`, `lib/draft/client.ts`, `lib/draft/poolView.ts`) with their own unit tests. Everything that *makes it happen* is thin: routes validate and call the repo; the repo calls one locked SQL function per state change. The memory repo emulates those functions using the same pure math, so route tests exercise real race outcomes without a database; `scripts/smoke-v2.ts` then proves the SQL matches.

## Conventions for route tests in this plan

Route tests mock three modules the same way v1 tests do (`tests/api/picks.test.ts`): `@/lib/db` (→ memory repo), `@/lib/tba/client` (→ fake `getTba`), and `@/lib/auth/session` (→ a settable signed-in user). SP4 also mocks `@/lib/realtime/doorbell` so tests can assert that a ring happened. The shared setup lives in `tests/helpers/draftMocks.ts` and `tests/helpers/draft.ts` (Task 5); Tasks 5–11 import them. (`sessionModule` behaves like SP1's `fakeSession`, but reads `mocks.user`, so SP4 tests set `mocks.user = …` explicitly; SP1's `seedLeague` also calls SP1's `setUser`, which these tests ignore.) The memory repo takes an injectable clock (`createMemoryRepo({ now })`, Task 1) so deadline tests control time.

---

### Task 1: Migration `0003_live_draft.sql` + draft fields on rounds and picks

**Files:**
- Create: `supabase/migrations/0003_live_draft.sql`
- Modify: `lib/db/types.ts` (`RoundRow`, `PickRow`)
- Modify: `lib/db/repo.ts` (`RoundPatch`, `NewPick`)
- Modify: `lib/db/supabaseRepo.ts` (`toRound`, `toPick`, `updateRound`, `insertPick`)
- Modify: `tests/helpers/memoryRepo.ts` (injectable clock, new defaults)
- Test: `tests/db/liveDraftRepo.test.ts` (new)

**Interfaces:**
- Consumes: SP1 `seedLeague(repo)` → `{ league, commissioner, user }`.
- Produces: `RoundRow.draftMode: 'commissioner' | 'live'`, `RoundRow.pickSeconds: PickSeconds | null`, `RoundRow.draftStartedAt / draftPausedAt / pickDeadline: string | null`, `RoundRow.pausedRemainingMs: number | null`, `PickRow.auto: boolean`, `export type PickSeconds = 30 | 60 | 90 | 120`, `export const PICK_SECONDS: readonly PickSeconds[]`, `RoundPatch.draftMode? / pickSeconds? / pausedRemainingMs?`, `NewPick.auto?: boolean`, `createMemoryRepo(opts?: { now?: () => Date })`. The SQL functions are used by Task 3.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0003_live_draft.sql`:

```sql
-- FRC Fantasy v2 · SP4 live draft room (spec §7, §8.2). Additive: v1/SP1 code keeps working.

alter table rounds
  add column draft_mode           text not null default 'commissioner' check (draft_mode in ('commissioner', 'live')),
  add column pick_seconds         integer check (pick_seconds in (30, 60, 90, 120)),   -- null = no timer
  add column draft_started_at     timestamptz,
  add column draft_paused_at      timestamptz,          -- non-null = paused
  add column paused_remaining_ms  integer,              -- remaining time when paused (timer only); null = full timer on resume
  add column pick_deadline        timestamptz;          -- current pick's deadline; null if no timer, paused, not started, or done

alter table picks
  add column auto  boolean not null default false;      -- true when made by tick/advance (undo uses it, §7.3)

create table draft_queue (
  round_id   uuid not null references rounds(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  team_key   text not null check (team_key ~ '^frc[1-9][0-9]{0,4}[A-Z]?$'),
  position   integer not null check (position >= 0),
  primary key (round_id, player_id, team_key)
);
create index draft_queue_player_idx on draft_queue (round_id, player_id, position);

create table draft_prefs (
  round_id   uuid not null references rounds(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  autodraft  boolean not null default false,
  primary key (round_id, player_id)
);

alter table draft_queue enable row level security;
alter table draft_prefs enable row level security;

-- §7.2: one live-draft pick, atomically. Returns false (never raises) when a check fails.
create or replace function draft_make_pick(
  p_round_id uuid, p_pick_number integer, p_player_id uuid, p_team_key text,
  p_require_due boolean, p_auto boolean
) returns boolean
language plpgsql
set search_path = public
as $$
declare
  r      rounds%rowtype;
  n      integer;
  total  integer;
begin
  select * into r from rounds where id = p_round_id for update;
  if not found then return false; end if;
  if r.draft_mode <> 'live' or r.draft_started_at is null or r.draft_paused_at is not null then
    return false;
  end if;
  total := r.roster_size * coalesce(cardinality(r.draft_order), 0);
  select count(*) into n from picks where round_id = p_round_id;
  if n >= total or n <> p_pick_number then return false; end if;
  if p_require_due and (r.pick_deadline is null or now() < r.pick_deadline) then return false; end if;
  begin
    insert into picks (round_id, pick_number, player_id, team_key, auto)
    values (p_round_id, p_pick_number, p_player_id, p_team_key, p_auto);
  exception when unique_violation then
    return false;  -- the team was taken (picks_round_team_key) or the slot is filled
  end;
  update rounds
     set pick_deadline = case
           when r.pick_seconds is null or n + 1 >= total then null
           else now() + make_interval(secs => r.pick_seconds)
         end
   where id = p_round_id;
  return true;
end;
$$;

-- §7.2: live-mode undo of the last pick, atomically, with the deadline restarted.
create or replace function draft_undo_pick(p_round_id uuid, p_pick_number integer) returns boolean
language plpgsql
set search_path = public
as $$
declare
  r  rounds%rowtype;
  n  integer;
begin
  select * into r from rounds where id = p_round_id for update;
  if not found then return false; end if;
  select count(*) into n from picks where round_id = p_round_id;
  if n = 0 or p_pick_number <> n - 1 then return false; end if;
  delete from picks where round_id = p_round_id and pick_number = p_pick_number;
  update rounds
     set pick_deadline = case
           when r.pick_seconds is null or r.draft_started_at is null or r.draft_paused_at is not null then null
           else now() + make_interval(secs => r.pick_seconds)
         end
   where id = p_round_id;
  return true;
end;
$$;

-- Start / pause / resume with the database clock under the same row lock (plan deviation 1; spec §7.1).
create or replace function draft_control(p_round_id uuid, p_action text) returns boolean
language plpgsql
set search_path = public
as $$
declare
  r  rounds%rowtype;
begin
  select * into r from rounds where id = p_round_id for update;
  if not found then return false; end if;
  if p_action = 'start' then
    if r.draft_mode <> 'live' or r.draft_started_at is not null then return false; end if;
    update rounds
       set draft_started_at = now(), draft_paused_at = null, paused_remaining_ms = null,
           pick_deadline = case when r.pick_seconds is null then null
                                else now() + make_interval(secs => r.pick_seconds) end
     where id = p_round_id;
  elsif p_action = 'pause' then
    if r.draft_started_at is null or r.draft_paused_at is not null then return false; end if;
    update rounds
       set draft_paused_at = now(),
           paused_remaining_ms = case when r.pick_deadline is null then null
             else greatest(0, floor(extract(epoch from (r.pick_deadline - now())) * 1000))::integer end,
           pick_deadline = null
     where id = p_round_id;
  elsif p_action = 'resume' then
    if r.draft_paused_at is null then return false; end if;
    update rounds
       set draft_paused_at = null,
           pick_deadline = case
             when r.pick_seconds is null then null
             when r.paused_remaining_ms is null then now() + make_interval(secs => r.pick_seconds)
             else now() + make_interval(secs => greatest(r.paused_remaining_ms, 10000) / 1000.0)
           end
     where id = p_round_id;
  else
    return false;
  end if;
  return true;
end;
$$;

-- For scripts/smoke-v2.ts (§8.1): every public table must have RLS on.
create or replace function public_tables_without_rls() returns setof text
language sql
stable
set search_path = public
as $$
  select c.relname::text
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
$$;

revoke execute on function draft_make_pick(uuid, integer, uuid, text, boolean, boolean) from public, anon, authenticated;
revoke execute on function draft_undo_pick(uuid, integer) from public, anon, authenticated;
revoke execute on function draft_control(uuid, text) from public, anon, authenticated;
revoke execute on function public_tables_without_rls() from public, anon, authenticated;
grant execute on function draft_make_pick(uuid, integer, uuid, text, boolean, boolean) to service_role;
grant execute on function draft_undo_pick(uuid, integer) to service_role;
grant execute on function draft_control(uuid, text) to service_role;
grant execute on function public_tables_without_rls() to service_role;
```

- [ ] **Step 2: Write the failing repo test**

Create `tests/db/liveDraftRepo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultScoring } from '@/lib/scoring/config';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

async function setup(now = new Date('2026-10-23T23:00:00.000Z')) {
  const clock = { now };
  const repo = createMemoryRepo({ now: () => clock.now });
  const { league, commissioner } = await seedLeague(repo);
  const round = await repo.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
    scoring: defaultScoring(),
  });
  return { repo, clock, league, commissioner, round };
}

describe('live draft columns', () => {
  it('new rounds start in commissioner mode with no timer and no draft state', async () => {
    const { round } = await setup();
    expect(round).toMatchObject({
      draftMode: 'commissioner', pickSeconds: null, draftStartedAt: null,
      draftPausedAt: null, pausedRemainingMs: null, pickDeadline: null,
    });
  });

  it('updateRound stores draftMode, pickSeconds and pausedRemainingMs', async () => {
    const { repo, round } = await setup();
    const saved = await repo.updateRound(round.id, { draftMode: 'live', pickSeconds: 60, pausedRemainingMs: null });
    expect(saved).toMatchObject({ draftMode: 'live', pickSeconds: 60, pausedRemainingMs: null });
    expect((await repo.updateRound(round.id, { pickSeconds: null })).pickSeconds).toBeNull();
  });

  it('insertPick records auto = false unless told otherwise', async () => {
    const { repo, round, commissioner } = await setup();
    await repo.updateRound(round.id, { draftOrder: [commissioner.id] });
    const pick = await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: commissioner.id, teamKey: 'frc1' });
    expect(pick.auto).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/db/liveDraftRepo.test.ts`
Expected: FAIL — TypeScript/`toMatchObject` mismatches: `draftMode` is `undefined`, and `createMemoryRepo` doesn't accept options.

- [ ] **Step 4: Add the row types**

In `lib/db/types.ts`, add above `RoundRow`:

```ts
export type PickSeconds = 30 | 60 | 90 | 120;
export const PICK_SECONDS: readonly PickSeconds[] = [30, 60, 90, 120];
export type DraftMode = 'commissioner' | 'live';
```

Add to `RoundRow` (after `finalizedAt`):

```ts
  draftMode: DraftMode;
  /** null = no pick timer. */
  pickSeconds: PickSeconds | null;
  draftStartedAt: string | null;
  /** Non-null = paused. */
  draftPausedAt: string | null;
  /** Time left on the clock when paused; null = give the full timer on resume. */
  pausedRemainingMs: number | null;
  /** The current pick's deadline (database clock); null if no timer, paused, not started, or done. */
  pickDeadline: string | null;
```

Add to `PickRow` (after `teamKey`): `  /** True when tick/advance made the pick. */\n  auto: boolean;`

- [ ] **Step 5: Extend the repo input types**

In `lib/db/repo.ts`, change the imports and types:

```ts
import type { DraftMode, PickSeconds } from '@/lib/db/types';
```

```ts
export type RoundPatch = {
  rosterSize?: number;
  draftOrder?: string[];
  scoring?: ScoringConfig;
  finalizedAt?: string | null;
  draftMode?: DraftMode;
  pickSeconds?: PickSeconds | null;
  pausedRemainingMs?: number | null;
};
export type NewPick = { roundId: string; pickNumber: number; playerId: string; teamKey: string; auto?: boolean };
```

- [ ] **Step 6: Map the new columns in the Supabase repo**

In `lib/db/supabaseRepo.ts`, add to `toRound` (after `finalizedAt`):

```ts
  draftMode: r.draft_mode ?? 'commissioner',
  pickSeconds: r.pick_seconds ?? null,
  draftStartedAt: r.draft_started_at ?? null,
  draftPausedAt: r.draft_paused_at ?? null,
  pausedRemainingMs: r.paused_remaining_ms ?? null,
  pickDeadline: r.pick_deadline ?? null,
```

Add to `toPick`: `  auto: r.auto ?? false,`

In `updateRound`'s `defined({...})` add:

```ts
              draft_mode: patch.draftMode,
              pick_seconds: patch.pickSeconds,
              paused_remaining_ms: patch.pausedRemainingMs,
```

In `insertPick`'s insert object add `auto: input.auto ?? false,`.

- [ ] **Step 7: Teach the memory repo the new columns and a clock**

In `tests/helpers/memoryRepo.ts`:

Change the signature and add a clock right under it:

```ts
/** A Repo that lives in memory and enforces the same unique constraints as the real schema.
 *  `now` is the "database clock" the live-draft functions use (Task 3); tests pass a fake one. */
export function createMemoryRepo(opts: { now?: () => Date } = {}): Repo {
  const dbNow = opts.now ?? (() => new Date());
```

In `createRound`, add defaults before `...copy(input)`:

```ts
        draftMode: 'commissioner',
        pickSeconds: null,
        draftStartedAt: null,
        draftPausedAt: null,
        pausedRemainingMs: null,
        pickDeadline: null,
```

In `insertPick`, change the row to `const row: PickRow = { id: randomUUID(), createdAt: stamp(), ...input, auto: input.auto ?? false };`

(`dbNow` is used in Task 3. If TypeScript flags it unused, that's only a hint; `tsc` doesn't fail on unused locals in this repo — check `tsconfig.json` has no `noUnusedLocals`; if it does, add the Task 3 methods in the same commit.)

- [ ] **Step 8: Run the tests and typecheck**

Run: `npx vitest run tests/db/liveDraftRepo.test.ts && npm run typecheck`
Expected: 3 passed; typecheck clean. If typecheck points at other files that build `RoundRow`/`PickRow` literals (for example `tests/helpers/builders.ts` or view tests), add the six draft fields with the defaults above (`draftMode: 'commissioner'`, the rest `null`) and `auto: false`.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: all green (baseline after SP1 + 3).

- [ ] **Step 10: Apply the migration to Supabase**

There is one Supabase project (dev and production share it), and this migration only adds things, so it is safe to apply now; the running site ignores the new columns and functions. Joey pastes `supabase/migrations/0003_live_draft.sql` into the Supabase SQL Editor and runs it. Then run this in the SQL Editor to confirm:

```sql
select proname from pg_proc where proname in ('draft_make_pick', 'draft_undo_pick', 'draft_control', 'public_tables_without_rls');
select public_tables_without_rls();
```

Expected: four function names; the second query returns **zero rows**.

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/0003_live_draft.sql lib/db/types.ts lib/db/repo.ts lib/db/supabaseRepo.ts tests/helpers/memoryRepo.ts tests/db/liveDraftRepo.test.ts
git commit -m "feat(draft): 0003 live draft migration + draft fields on rounds and picks"
```

(End the message with the session's `Co-Authored-By:` line.)

---

### Task 2: Pure live-draft logic (`lib/draft/live.ts`) + `roundStatus` → Drafting once started

**Files:**
- Create: `lib/draft/live.ts`
- Modify: `lib/rounds/status.ts` (`roundStatus`)
- Test: `tests/draft/live.test.ts` (new), `tests/rounds/status.test.ts` (add one test)

**Interfaces:**
- Consumes: `pickerFor(pickNumber, order)` (`lib/scoring/round.ts`, 0-based snake order), `RoundRow`/`PickSeconds` (Task 1).
- Produces (all pure, browser-safe — no `node:` or `lib/db` runtime imports):
  - `type DraftPhase = 'setup' | 'live' | 'paused' | 'done'`
  - `type DraftRoundFields = Pick<RoundRow, 'draftMode' | 'draftStartedAt' | 'draftPausedAt' | 'rosterSize' | 'draftOrder'>`
  - `draftPhase(round: DraftRoundFields, pickCount: number): DraftPhase`
  - `totalPicks(round: Pick<RoundRow, 'rosterSize' | 'draftOrder'>): number`
  - `onClockPlayer(round: Pick<RoundRow, 'rosterSize' | 'draftOrder'>, pickCount: number): string | null`
  - `picksUntilTurn(round: Pick<RoundRow, 'rosterSize' | 'draftOrder'>, pickCount: number, playerId: string): number | null`
  - `RESUME_FLOOR_MS = 10_000`
  - `nextDeadline(pickSeconds: PickSeconds | null, picksAfter: number, total: number, nowMs: number): string | null`
  - `pausedRemainingMs(pickDeadline: string | null, nowMs: number): number | null`
  - `resumeDeadline(pickSeconds: PickSeconds | null, remainingMs: number | null, nowMs: number): string | null`
  - `chooseAutoPick(queue: string[], available: { teamKey: string; proj: number | null }[]): string | null`
  - `clockOffset(serverNow: string, sentAtMs: number, receivedAtMs: number): number`
  - `remainingMs(deadline: string | null, offsetMs: number, localNowMs: number): number | null`
  - `roundStatus` accepts an optional `draftStartedAt` and returns `'drafting'` for a started live draft with 0 picks.

- [ ] **Step 1: Write the failing tests**

Create `tests/draft/live.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  chooseAutoPick,
  clockOffset,
  draftPhase,
  nextDeadline,
  onClockPlayer,
  pausedRemainingMs,
  picksUntilTurn,
  remainingMs,
  resumeDeadline,
  totalPicks,
} from '@/lib/draft/live';

const base = {
  draftMode: 'live' as const,
  draftStartedAt: null as string | null,
  draftPausedAt: null as string | null,
  rosterSize: 2,
  draftOrder: ['joey', 'mom', 'dad'],
};
const T0 = Date.parse('2026-10-23T23:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('draftPhase (§7.1)', () => {
  it('is setup before start, live once started, paused while paused, done when full', () => {
    expect(draftPhase(base, 0)).toBe('setup');
    const started = { ...base, draftStartedAt: iso(T0) };
    expect(draftPhase(started, 0)).toBe('live');
    expect(draftPhase({ ...started, draftPausedAt: iso(T0 + 1000) }, 3)).toBe('paused');
    expect(draftPhase(started, 6)).toBe('done');
  });
  it('treats commissioner-mode rounds as setup until full (v1 behaves as before)', () => {
    const v1 = { ...base, draftMode: 'commissioner' as const };
    expect(draftPhase(v1, 3)).toBe('setup');
    expect(draftPhase(v1, 6)).toBe('done');
  });
  it('an empty draft order is never done', () => {
    expect(draftPhase({ ...base, draftOrder: [] }, 0)).toBe('setup');
  });
});

describe('whose turn', () => {
  it('follows the snake: joey mom dad dad mom joey', () => {
    expect(totalPicks(base)).toBe(6);
    expect([0, 1, 2, 3, 4, 5].map((n) => onClockPlayer(base, n))).toEqual(['joey', 'mom', 'dad', 'dad', 'mom', 'joey']);
    expect(onClockPlayer(base, 6)).toBeNull();
    expect(onClockPlayer({ ...base, draftOrder: [] }, 0)).toBeNull();
  });
  it('counts picks until my turn (0 = on the clock, null = no turns left)', () => {
    expect(picksUntilTurn(base, 0, 'joey')).toBe(0);
    expect(picksUntilTurn(base, 0, 'dad')).toBe(2);
    expect(picksUntilTurn(base, 1, 'joey')).toBe(4);
    expect(picksUntilTurn(base, 6, 'joey')).toBeNull();
    expect(picksUntilTurn(base, 0, 'stranger')).toBeNull();
  });
});

describe('deadlines (§7.1, §7.2)', () => {
  it('sets the next deadline only while a timer is on and picks remain', () => {
    expect(nextDeadline(60, 1, 6, T0)).toBe(iso(T0 + 60_000));
    expect(nextDeadline(null, 1, 6, T0)).toBeNull();
    expect(nextDeadline(60, 6, 6, T0)).toBeNull();
  });
  it('pausing keeps the time left, never negative', () => {
    expect(pausedRemainingMs(iso(T0 + 42_000), T0)).toBe(42_000);
    expect(pausedRemainingMs(iso(T0 - 5_000), T0)).toBe(0);
    expect(pausedRemainingMs(null, T0)).toBeNull();
  });
  it('resuming gives at least 10 s, or the full timer when the remaining time was cleared', () => {
    expect(resumeDeadline(60, 42_000, T0)).toBe(iso(T0 + 42_000));
    expect(resumeDeadline(60, 0, T0)).toBe(iso(T0 + 10_000)); // Review Focus 3
    expect(resumeDeadline(60, 3_000, T0)).toBe(iso(T0 + 10_000));
    expect(resumeDeadline(90, null, T0)).toBe(iso(T0 + 90_000));
    expect(resumeDeadline(null, 42_000, T0)).toBeNull();
  });
});

describe('chooseAutoPick (§7.4)', () => {
  const avail = (...rows: [string, number | null][]) => rows.map(([teamKey, proj]) => ({ teamKey, proj }));
  it('takes the first queued team that is still available', () => {
    expect(chooseAutoPick(['frc254', 'frc341'], avail(['frc341', 10], ['frc1', 50]))).toBe('frc341');
  });
  it('falls back to the highest projection', () => {
    expect(chooseAutoPick([], avail(['frc1', 12], ['frc2', 30.5], ['frc3', 30.5]))).toBe('frc2');
  });
  it('puts New teams after projected ones, then lowest team number (B-teams after their A-team)', () => {
    expect(chooseAutoPick([], avail(['frc9', null], ['frc100', 1]))).toBe('frc100');
    expect(chooseAutoPick([], avail(['frc1000', null], ['frc341B', null], ['frc341', null]))).toBe('frc341');
  });
  it('returns null when nothing is available', () => {
    expect(chooseAutoPick(['frc1'], [])).toBeNull();
  });
});

describe('clock sync (§7.5)', () => {
  it('estimates the server-minus-local offset from the round trip', () => {
    // Sent at local 1000, received at local 1200 (rtt 200); server said T0 at the midpoint (local 1100).
    expect(clockOffset(iso(T0), 1000, 1200)).toBe(T0 - 1100);
  });
  it('a phone clock that is 3 minutes fast still counts down the server deadline', () => {
    const fast = 180_000;
    const offset = clockOffset(iso(T0), T0 + fast - 100, T0 + fast + 100);
    expect(remainingMs(iso(T0 + 30_000), offset, T0 + fast)).toBe(30_000);
    expect(remainingMs(iso(T0 - 1), offset, T0 + fast)).toBe(0);
    expect(remainingMs(null, offset, T0)).toBeNull();
  });
});
```

Add to `tests/rounds/status.test.ts`, inside `describe('roundStatus (§7.8)', …)`:

```ts
  it('is Drafting once a live draft has started, even before the first pick (v2 §7.1)', () => {
    expect(roundStatus({ ...drafted, draftStartedAt: '2026-10-23T23:00:00Z' }, 0, eventDay)).toBe('drafting');
    expect(roundStatus({ ...drafted, draftStartedAt: null }, 0, eventDay)).toBe('setup');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/draft/live.test.ts tests/rounds/status.test.ts`
Expected: FAIL — `Cannot find module '@/lib/draft/live'`, and the new status test returns `'setup'`.

- [ ] **Step 3: Implement `lib/draft/live.ts`**

```ts
// Pure live-draft rules (spec §7). Safe to import in the browser: no database or Node imports.
import type { PickSeconds, RoundRow } from '@/lib/db/types';
import { pickerFor } from '@/lib/scoring/round';

export type DraftPhase = 'setup' | 'live' | 'paused' | 'done';
export type DraftRoundFields = Pick<
  RoundRow,
  'draftMode' | 'draftStartedAt' | 'draftPausedAt' | 'rosterSize' | 'draftOrder'
>;
type Size = Pick<RoundRow, 'rosterSize' | 'draftOrder'>;

/** Spec §7.1: a resumed pick never gets less than this, even if the clock had run out. */
export const RESUME_FLOOR_MS = 10_000;

export function totalPicks(round: Size): number {
  return round.rosterSize * round.draftOrder.length;
}

export function draftPhase(round: DraftRoundFields, pickCount: number): DraftPhase {
  const total = totalPicks(round);
  if (total > 0 && pickCount >= total) return 'done';
  if (round.draftMode !== 'live' || !round.draftStartedAt) return 'setup';
  return round.draftPausedAt ? 'paused' : 'live';
}

export function onClockPlayer(round: Size, pickCount: number): string | null {
  if (round.draftOrder.length === 0 || pickCount >= totalPicks(round)) return null;
  return pickerFor(pickCount, round.draftOrder);
}

/** Picks before `playerId` is on the clock: 0 = now, null = no turns left. */
export function picksUntilTurn(round: Size, pickCount: number, playerId: string): number | null {
  const total = totalPicks(round);
  for (let n = pickCount; n < total; n++) {
    if (pickerFor(n, round.draftOrder) === playerId) return n - pickCount;
  }
  return null;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** The deadline after a pick. `picksAfter` counts the picks made including the one just made. */
export function nextDeadline(
  pickSeconds: PickSeconds | null,
  picksAfter: number,
  total: number,
  nowMs: number,
): string | null {
  if (pickSeconds === null || picksAfter >= total) return null;
  return iso(nowMs + pickSeconds * 1000);
}

export function pausedRemainingMs(pickDeadline: string | null, nowMs: number): number | null {
  if (!pickDeadline) return null;
  return Math.max(0, Date.parse(pickDeadline) - nowMs);
}

export function resumeDeadline(
  pickSeconds: PickSeconds | null,
  remaining: number | null,
  nowMs: number,
): string | null {
  if (pickSeconds === null) return null;
  const ms = remaining === null ? pickSeconds * 1000 : Math.max(remaining, RESUME_FLOOR_MS);
  return iso(nowMs + ms);
}

function teamSortParts(teamKey: string): [number, string] {
  const m = /^frc([0-9]+)([A-Z]?)$/.exec(teamKey);
  return m ? [Number(m[1]), m[2]] : [Number.MAX_SAFE_INTEGER, teamKey];
}

/** Spec §7.4: queue first; then highest projection; "New" (null) after projected; then lowest team number. */
export function chooseAutoPick(
  queue: string[],
  available: { teamKey: string; proj: number | null }[],
): string | null {
  const open = new Set(available.map((t) => t.teamKey));
  const queued = queue.find((k) => open.has(k));
  if (queued) return queued;
  if (available.length === 0) return null;
  const best = [...available].sort((a, b) => {
    if (a.proj !== null && b.proj !== null && a.proj !== b.proj) return b.proj - a.proj;
    if ((a.proj === null) !== (b.proj === null)) return a.proj === null ? 1 : -1;
    const [an, as] = teamSortParts(a.teamKey);
    const [bn, bs] = teamSortParts(b.teamKey);
    return an - bn || as.localeCompare(bs);
  });
  return best[0].teamKey;
}

/** Spec §7.5: offset = serverNow − (receivedAt − rtt/2), in ms. Add it to Date.now() to get server time. */
export function clockOffset(serverNow: string, sentAtMs: number, receivedAtMs: number): number {
  const rtt = receivedAtMs - sentAtMs;
  return Date.parse(serverNow) - (receivedAtMs - rtt / 2);
}

export function remainingMs(deadline: string | null, offsetMs: number, localNowMs: number): number | null {
  if (!deadline) return null;
  return Math.max(0, Date.parse(deadline) - (localNowMs + offsetMs));
}
```

- [ ] **Step 4: Update `roundStatus`**

In `lib/rounds/status.ts`, change the signature and the setup line:

```ts
export function roundStatus(
  round: RoundTiming & { rosterSize: number; draftOrder: string[]; draftStartedAt?: string | null },
  pickCount: number,
  now: Date,
): RoundStatus {
  if (round.finalizedAt) return 'final';
  // v2 §7.1: a started live draft shows as Drafting even before the first pick.
  if (pickCount <= 0 && !round.draftStartedAt) return 'setup';
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/draft/live.test.ts tests/rounds/status.test.ts`
Expected: PASS (all new tests plus the existing status tests).

- [ ] **Step 6: Commit**

```bash
git add lib/draft/live.ts lib/rounds/status.ts tests/draft/live.test.ts tests/rounds/status.test.ts
git commit -m "feat(draft): pure live-draft rules and Drafting status once started"
```

---

### Task 3: Repo methods for atomic picks, undo, start/pause/resume, queue, and auto-draft

**Files:**
- Modify: `lib/db/repo.ts` (types + interface)
- Modify: `lib/db/supabaseRepo.ts` (rpc + queue/prefs queries)
- Modify: `tests/helpers/memoryRepo.ts` (emulation)
- Test: `tests/db/liveDraftRepo.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 columns/functions; Task 2 `totalPicks`, `nextDeadline`, `pausedRemainingMs`, `resumeDeadline`; SP1 `Repo.createMember({ leagueId, userId, name, role })`.
- Produces (on `Repo`):
  - `type AtomicPick = { roundId: string; pickNumber: number; playerId: string; teamKey: string; requireDue: boolean; auto: boolean }`
  - `type DraftAction = 'start' | 'pause' | 'resume'`
  - `makePickAtomic(input: AtomicPick): Promise<boolean>`
  - `undoPickAtomic(roundId: string, pickNumber: number): Promise<boolean>`
  - `draftControl(roundId: string, action: DraftAction): Promise<boolean>` *(contract addition, deviation 1)*
  - `getQueue(roundId: string, playerId: string): Promise<string[]>` (in position order)
  - `setQueue(roundId: string, playerId: string, teamKeys: string[]): Promise<void>` (replaces)
  - `getAutodraft(roundId: string, playerId: string): Promise<boolean>` (false when unset)
  - `setAutodraft(roundId: string, playerId: string, on: boolean): Promise<void>`
  - `listAutodraftPlayers(roundId: string): Promise<string[]>`
  - `rlsDisabledTables(): Promise<string[]>` (used only by `scripts/smoke-v2.ts`; the memory repo returns `[]`)

- [ ] **Step 1: Write the failing tests**

Append to `tests/db/liveDraftRepo.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

async function liveSetup(opts: { pickSeconds?: 30 | 60 | 90 | 120 | null } = {}) {
  const s = await setup();
  const mom = await s.repo.createMember({ leagueId: s.league.id, userId: randomUUID(), name: 'Mom', role: 'player' });
  const round = await s.repo.updateRound(s.round.id, {
    draftOrder: [s.commissioner.id, mom.id], rosterSize: 2, draftMode: 'live',
    pickSeconds: opts.pickSeconds === undefined ? 60 : opts.pickSeconds,
  });
  const at = (seconds: number) => new Date(s.clock.now.getTime() + seconds * 1000);
  const pick = (pickNumber: number, teamKey: string, extra: { requireDue?: boolean; auto?: boolean; playerId?: string } = {}) =>
    s.repo.makePickAtomic({
      roundId: round.id, pickNumber, teamKey,
      playerId: extra.playerId ?? s.commissioner.id,
      requireDue: extra.requireDue ?? false, auto: extra.auto ?? false,
    });
  const reload = async () => (await s.repo.getRound(round.id))!;
  return { ...s, mom, round, at, pick, reload };
}

describe('draftControl start (§7.1)', () => {
  it('starts a live round once, setting the first deadline from the database clock', async () => {
    const t = await liveSetup();
    expect(await t.repo.draftControl(t.round.id, 'start')).toBe(true);
    const r = await t.reload();
    expect(r.draftStartedAt).toBe(t.clock.now.toISOString());
    expect(r.pickDeadline).toBe(t.at(60).toISOString());
    expect(await t.repo.draftControl(t.round.id, 'start')).toBe(false);
  });
  it('refuses to start a commissioner-mode round', async () => {
    const t = await liveSetup();
    await t.repo.updateRound(t.round.id, { draftMode: 'commissioner' });
    expect(await t.repo.draftControl(t.round.id, 'start')).toBe(false);
  });
  it('with the timer off, there is no deadline', async () => {
    const t = await liveSetup({ pickSeconds: null });
    await t.repo.draftControl(t.round.id, 'start');
    expect((await t.reload()).pickDeadline).toBeNull();
  });
});

describe('makePickAtomic (§7.2)', () => {
  it('refuses before the draft starts and while paused', async () => {
    const t = await liveSetup();
    expect(await t.pick(0, 'frc1')).toBe(false);
    await t.repo.draftControl(t.round.id, 'start');
    await t.repo.draftControl(t.round.id, 'pause');
    expect(await t.pick(0, 'frc1')).toBe(false);
  });
  it('saves the pick, records auto, and moves the deadline', async () => {
    const t = await liveSetup();
    await t.repo.draftControl(t.round.id, 'start');
    t.clock.now = t.at(5);
    expect(await t.pick(0, 'frc1', { auto: true })).toBe(true);
    const [saved] = await t.repo.listPicks(t.round.id);
    expect(saved).toMatchObject({ pickNumber: 0, teamKey: 'frc1', auto: true });
    expect((await t.reload()).pickDeadline).toBe(t.at(60).toISOString());
  });
  it('refuses a stale pick number and a taken team without throwing', async () => {
    const t = await liveSetup();
    await t.repo.draftControl(t.round.id, 'start');
    await t.pick(0, 'frc1');
    expect(await t.pick(0, 'frc2')).toBe(false); // stale
    expect(await t.pick(1, 'frc1', { playerId: t.mom.id })).toBe(false); // taken
    expect(await t.repo.listPicks(t.round.id)).toHaveLength(1);
  });
  it('two phones picking the same slot at once: exactly one wins (Review Focus 1)', async () => {
    const t = await liveSetup();
    await t.repo.draftControl(t.round.id, 'start');
    const results = await Promise.all([t.pick(0, 'frc1'), t.pick(0, 'frc2'), t.pick(0, 'frc1')]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await t.repo.listPicks(t.round.id)).toHaveLength(1);
  });
  it('requireDue waits for the database deadline', async () => {
    const t = await liveSetup({ pickSeconds: 30 });
    await t.repo.draftControl(t.round.id, 'start');
    t.clock.now = t.at(29);
    expect(await t.pick(0, 'frc1', { requireDue: true })).toBe(false);
    t.clock.now = t.at(1);
    expect(await t.pick(0, 'frc1', { requireDue: true })).toBe(true);
  });
  it('requireDue never fires with the timer off', async () => {
    const t = await liveSetup({ pickSeconds: null });
    await t.repo.draftControl(t.round.id, 'start');
    expect(await t.pick(0, 'frc1', { requireDue: true })).toBe(false);
  });
  it('clears the deadline after the last pick and refuses more', async () => {
    const t = await liveSetup();
    await t.repo.draftControl(t.round.id, 'start');
    for (const [n, team] of [[0, 'frc1'], [1, 'frc2'], [2, 'frc3'], [3, 'frc4']] as const) {
      expect(await t.pick(n, team)).toBe(true);
    }
    expect((await t.reload()).pickDeadline).toBeNull();
    expect(await t.pick(4, 'frc5')).toBe(false);
  });
});

describe('undoPickAtomic (§7.2)', () => {
  it('removes only the last pick and restarts the deadline', async () => {
    const t = await liveSetup();
    await t.repo.draftControl(t.round.id, 'start');
    await t.pick(0, 'frc1');
    await t.pick(1, 'frc2');
    t.clock.now = t.at(20);
    expect(await t.repo.undoPickAtomic(t.round.id, 0)).toBe(false);
    expect(await t.repo.undoPickAtomic(t.round.id, 1)).toBe(true);
    expect((await t.repo.listPicks(t.round.id)).map((p) => p.teamKey)).toEqual(['frc1']);
    expect((await t.reload()).pickDeadline).toBe(t.at(60).toISOString());
  });
  it('undo while paused leaves the deadline empty', async () => {
    const t = await liveSetup();
    await t.repo.draftControl(t.round.id, 'start');
    await t.pick(0, 'frc1');
    await t.repo.draftControl(t.round.id, 'pause');
    expect(await t.repo.undoPickAtomic(t.round.id, 0)).toBe(true);
    expect((await t.reload()).pickDeadline).toBeNull();
  });
});

describe('pause / resume (§7.1)', () => {
  it('keeps the time left and gives it back on resume', async () => {
    const t = await liveSetup();
    await t.repo.draftControl(t.round.id, 'start');
    t.clock.now = t.at(18);
    expect(await t.repo.draftControl(t.round.id, 'pause')).toBe(true);
    expect(await t.reload()).toMatchObject({ pausedRemainingMs: 42_000, pickDeadline: null });
    t.clock.now = t.at(300);
    expect(await t.repo.draftControl(t.round.id, 'resume')).toBe(true);
    expect(await t.reload()).toMatchObject({ draftPausedAt: null, pickDeadline: t.at(42).toISOString() });
  });
  it('paused after the clock ran out: resume gives 10 s (Review Focus 3)', async () => {
    const t = await liveSetup({ pickSeconds: 30 });
    await t.repo.draftControl(t.round.id, 'start');
    t.clock.now = t.at(45);
    await t.repo.draftControl(t.round.id, 'pause');
    expect((await t.reload()).pausedRemainingMs).toBe(0);
    await t.repo.draftControl(t.round.id, 'resume');
    expect((await t.reload()).pickDeadline).toBe(t.at(10).toISOString());
  });
  it('a cleared remaining time (timer changed while paused) resumes with the full new timer', async () => {
    const t = await liveSetup({ pickSeconds: 30 });
    await t.repo.draftControl(t.round.id, 'start');
    await t.repo.draftControl(t.round.id, 'pause');
    await t.repo.updateRound(t.round.id, { pickSeconds: 90, pausedRemainingMs: null });
    await t.repo.draftControl(t.round.id, 'resume');
    expect((await t.reload()).pickDeadline).toBe(t.at(90).toISOString());
  });
  it('refuses to pause twice or resume a running draft', async () => {
    const t = await liveSetup();
    await t.repo.draftControl(t.round.id, 'start');
    expect(await t.repo.draftControl(t.round.id, 'resume')).toBe(false);
    await t.repo.draftControl(t.round.id, 'pause');
    expect(await t.repo.draftControl(t.round.id, 'pause')).toBe(false);
  });
});

describe('queue and auto-draft', () => {
  it('replaces and returns the queue in order', async () => {
    const t = await liveSetup();
    expect(await t.repo.getQueue(t.round.id, t.mom.id)).toEqual([]);
    await t.repo.setQueue(t.round.id, t.mom.id, ['frc3', 'frc1']);
    await t.repo.setQueue(t.round.id, t.mom.id, ['frc2', 'frc3']);
    expect(await t.repo.getQueue(t.round.id, t.mom.id)).toEqual(['frc2', 'frc3']);
    expect(await t.repo.getQueue(t.round.id, t.commissioner.id)).toEqual([]);
  });
  it('stores auto-draft per player', async () => {
    const t = await liveSetup();
    expect(await t.repo.getAutodraft(t.round.id, t.mom.id)).toBe(false);
    await t.repo.setAutodraft(t.round.id, t.mom.id, true);
    expect(await t.repo.getAutodraft(t.round.id, t.mom.id)).toBe(true);
    expect(await t.repo.listAutodraftPlayers(t.round.id)).toEqual([t.mom.id]);
    await t.repo.setAutodraft(t.round.id, t.mom.id, false);
    expect(await t.repo.listAutodraftPlayers(t.round.id)).toEqual([]);
  });
});
```

(Move the `randomUUID` import to the top of the file with the other imports.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/db/liveDraftRepo.test.ts`
Expected: FAIL — `t.repo.draftControl is not a function` (and the other new methods).

- [ ] **Step 3: Add the interface**

In `lib/db/repo.ts` add the types and append to `interface Repo`:

```ts
export type AtomicPick = {
  roundId: string;
  pickNumber: number;
  playerId: string;
  teamKey: string;
  /** true = only pick if the database clock is past pick_deadline (timeouts). */
  requireDue: boolean;
  /** true = made by tick/advance, not a person. */
  auto: boolean;
};
export type DraftAction = 'start' | 'pause' | 'resume';
```

```ts
  // Live draft (v2 §7). Each returns false instead of throwing when the draft state doesn't allow it.
  makePickAtomic(input: AtomicPick): Promise<boolean>;
  undoPickAtomic(roundId: string, pickNumber: number): Promise<boolean>;
  draftControl(roundId: string, action: DraftAction): Promise<boolean>;
  getQueue(roundId: string, playerId: string): Promise<string[]>;
  setQueue(roundId: string, playerId: string, teamKeys: string[]): Promise<void>;
  getAutodraft(roundId: string, playerId: string): Promise<boolean>;
  setAutodraft(roundId: string, playerId: string, on: boolean): Promise<void>;
  listAutodraftPlayers(roundId: string): Promise<string[]>;
  /** Tables in `public` with RLS off. Must always be empty (v2 §8.1). */
  rlsDisabledTables(): Promise<string[]>;
```

- [ ] **Step 4: Implement them in the Supabase repo**

In `lib/db/supabaseRepo.ts`, add a helper under `first`:

```ts
/** A Postgres function that returns boolean arrives as a bare `true`/`false`. */
async function rpcBool(query: PromiseLike<Result>): Promise<boolean> {
  const rows = await run(query);
  return (rows[0] as unknown) === true;
}
```

and add to the returned object:

```ts
    async makePickAtomic(input) {
      return rpcBool(
        db.rpc('draft_make_pick', {
          p_round_id: input.roundId,
          p_pick_number: input.pickNumber,
          p_player_id: input.playerId,
          p_team_key: input.teamKey,
          p_require_due: input.requireDue,
          p_auto: input.auto,
        }),
      );
    },
    async undoPickAtomic(roundId, pickNumber) {
      return rpcBool(db.rpc('draft_undo_pick', { p_round_id: roundId, p_pick_number: pickNumber }));
    },
    async draftControl(roundId, action) {
      return rpcBool(db.rpc('draft_control', { p_round_id: roundId, p_action: action }));
    },
    async getQueue(roundId, playerId) {
      const rows = await run(
        db.from('draft_queue').select('team_key').eq('round_id', roundId).eq('player_id', playerId).order('position'),
      );
      return rows.map((r) => r.team_key as string);
    },
    async setQueue(roundId, playerId, teamKeys) {
      // Two statements: only this player ever writes their own queue, so there's no race to guard.
      await run(db.from('draft_queue').delete().eq('round_id', roundId).eq('player_id', playerId));
      if (teamKeys.length === 0) return;
      await run(
        db.from('draft_queue').insert(
          teamKeys.map((teamKey, position) => ({ round_id: roundId, player_id: playerId, team_key: teamKey, position })),
        ),
      );
    },
    async getAutodraft(roundId, playerId) {
      const rows = await run(
        db.from('draft_prefs').select('autodraft').eq('round_id', roundId).eq('player_id', playerId),
      );
      return rows[0]?.autodraft === true;
    },
    async setAutodraft(roundId, playerId, on) {
      await run(
        db
          .from('draft_prefs')
          .upsert({ round_id: roundId, player_id: playerId, autodraft: on }, { onConflict: 'round_id,player_id' }),
      );
    },
    async listAutodraftPlayers(roundId) {
      const rows = await run(
        db.from('draft_prefs').select('player_id').eq('round_id', roundId).eq('autodraft', true),
      );
      return rows.map((r) => r.player_id as string);
    },
    async rlsDisabledTables() {
      const rows = await run(db.rpc('public_tables_without_rls'));
      return rows.map((r) => (typeof r === 'string' ? r : String(Object.values(r)[0])));
    },
```

- [ ] **Step 5: Emulate them in the memory repo**

In `tests/helpers/memoryRepo.ts`, add the import:

```ts
import { nextDeadline, pausedRemainingMs, resumeDeadline, totalPicks } from '@/lib/draft/live';
```

add state next to the other arrays:

```ts
  const queues = new Map<string, string[]>(); // `${roundId}|${playerId}` -> team keys in order
  const autodraft = new Map<string, boolean>();
  const qk = (roundId: string, playerId: string) => `${roundId}|${playerId}`;
```

extend `dropRounds` so deleting a round clears its queue and prefs:

```ts
    for (const map of [queues, autodraft]) {
      for (const key of [...map.keys()]) if (ids.some((id) => key.startsWith(`${id}|`))) map.delete(key);
    }
```

and add the methods. Each is written as one synchronous block (no `await` inside), so — like the real row lock — two calls can never interleave:

```ts
    async makePickAtomic(input) {
      const r = find(rounds, input.roundId, 'round');
      const inRound = picks.filter((p) => p.roundId === r.id);
      const total = totalPicks(r);
      const n = inRound.length;
      if (r.draftMode !== 'live' || !r.draftStartedAt || r.draftPausedAt) return false;
      if (n >= total || n !== input.pickNumber) return false;
      const nowMs = dbNow().getTime();
      if (input.requireDue && (!r.pickDeadline || nowMs < Date.parse(r.pickDeadline))) return false;
      if (inRound.some((p) => p.teamKey === input.teamKey)) return false;
      picks.push({
        id: randomUUID(), createdAt: stamp(), roundId: r.id, pickNumber: input.pickNumber,
        playerId: input.playerId, teamKey: input.teamKey, auto: input.auto,
      });
      r.pickDeadline = nextDeadline(r.pickSeconds, n + 1, total, nowMs);
      return true;
    },
    async undoPickAtomic(roundId, pickNumber) {
      const r = find(rounds, roundId, 'round');
      const n = picks.filter((p) => p.roundId === roundId).length;
      if (n === 0 || pickNumber !== n - 1) return false;
      picks = picks.filter((p) => !(p.roundId === roundId && p.pickNumber === pickNumber));
      r.pickDeadline =
        r.pickSeconds === null || !r.draftStartedAt || r.draftPausedAt
          ? null
          : nextDeadline(r.pickSeconds, 0, 1, dbNow().getTime());
      return true;
    },
    async draftControl(roundId, action) {
      const r = find(rounds, roundId, 'round');
      const nowMs = dbNow().getTime();
      const nowIso = new Date(nowMs).toISOString();
      if (action === 'start') {
        if (r.draftMode !== 'live' || r.draftStartedAt) return false;
        r.draftStartedAt = nowIso;
        r.draftPausedAt = null;
        r.pausedRemainingMs = null;
        r.pickDeadline = nextDeadline(r.pickSeconds, 0, 1, nowMs);
        return true;
      }
      if (action === 'pause') {
        if (!r.draftStartedAt || r.draftPausedAt) return false;
        r.draftPausedAt = nowIso;
        r.pausedRemainingMs = pausedRemainingMs(r.pickDeadline, nowMs);
        r.pickDeadline = null;
        return true;
      }
      if (!r.draftPausedAt) return false;
      r.draftPausedAt = null;
      r.pickDeadline = resumeDeadline(r.pickSeconds, r.pausedRemainingMs, nowMs);
      return true;
    },
    async getQueue(roundId, playerId) {
      return [...(queues.get(qk(roundId, playerId)) ?? [])];
    },
    async setQueue(roundId, playerId, teamKeys) {
      queues.set(qk(roundId, playerId), [...teamKeys]);
    },
    async getAutodraft(roundId, playerId) {
      return autodraft.get(qk(roundId, playerId)) ?? false;
    },
    async setAutodraft(roundId, playerId, on) {
      autodraft.set(qk(roundId, playerId), on);
    },
    async listAutodraftPlayers(roundId) {
      return [...autodraft.entries()]
        .filter(([key, on]) => on && key.startsWith(`${roundId}|`))
        .map(([key]) => key.split('|')[1]);
    },
    async rlsDisabledTables() {
      return [];
    },
```

(`nextDeadline(seconds, 0, 1, now)` is "a fresh full timer": 0 picks made of 1 remaining.)

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run tests/db/liveDraftRepo.test.ts && npm run typecheck`
Expected: PASS; typecheck clean. (If any other test file builds a full fake `Repo` object literal, typecheck will list it; add the new methods there as `async () => false` / `async () => []` stubs.)

- [ ] **Step 7: Commit**

```bash
git add lib/db/repo.ts lib/db/supabaseRepo.ts tests/helpers/memoryRepo.ts tests/db/liveDraftRepo.test.ts
git commit -m "feat(draft): atomic pick/undo/control repo methods, queue and auto-draft storage"
```

---

### Task 4: 409 codes on `HttpError`, pick-failure classifier, and the Realtime doorbell

**Files:**
- Modify: `lib/api/http.ts` (`HttpError`, `handle`)
- Create: `lib/draft/errors.ts`
- Create: `lib/realtime/doorbell.ts`
- Test: `tests/api/http.test.ts` (add one test), `tests/draft/errors.test.ts` (new), `tests/realtime/doorbell.test.ts` (new)

**Interfaces:**
- Consumes: `draftPhase` (Task 2), `Repo.getRound/listPicks`.
- Produces:
  - `new HttpError(status, message, code?)`; `handle()` responds `{ error, code }` when `code` is set.
  - `DRAFT_ERRORS: Record<DraftErrorCode, string>`, `type DraftErrorCode = 'not_live' | 'stale' | 'not_your_turn' | 'taken'`, `draftError(code): HttpError` (409), `classifyFailedPick(roundId, teamKey): Promise<HttpError>`.
  - `ring(roundId: string, deps?: Partial<RingDeps>): Promise<void>` (never throws), `draftTopic(roundId): string` = `` `draft:${roundId}` ``, `DOORBELL_EVENT = 'changed'`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/api/http.test.ts` inside the existing `describe` for `handle` (or a new `describe('handle', …)`):

```ts
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
```

Create `tests/draft/errors.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));

import { classifyFailedPick, draftError } from '@/lib/draft/errors';
import type { Repo } from '@/lib/db/repo';
import type { RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let round: RoundRow;
let joeyId: string;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  const { league, commissioner } = await seedLeague(repo);
  joeyId = commissioner.id;
  const mom = await repo.createMember({ leagueId: league.id, userId: randomUUID(), name: 'Mom', role: 'player' });
  const r = await repo.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
  });
  round = await repo.updateRound(r.id, { draftOrder: [joeyId, mom.id], rosterSize: 2, draftMode: 'live' });
  await repo.draftControl(round.id, 'start');
});

describe('classifyFailedPick', () => {
  it('says taken when the team is already on the board', async () => {
    await repo.makePickAtomic({ roundId: round.id, pickNumber: 0, playerId: joeyId, teamKey: 'frc1', requireDue: false, auto: false });
    const err = await classifyFailedPick(round.id, 'frc1');
    expect([err.status, err.code, err.message]).toEqual([409, 'taken', 'That team was just taken']);
  });
  it('says not_live when the draft is paused', async () => {
    await repo.draftControl(round.id, 'pause');
    expect((await classifyFailedPick(round.id, 'frc2')).code).toBe('not_live');
  });
  it('otherwise says stale', async () => {
    expect((await classifyFailedPick(round.id, 'frc2')).code).toBe('stale');
    expect(draftError('stale').message).toBe('Draft changed in another tab — refresh');
  });
});
```

Create `tests/realtime/doorbell.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { draftTopic, ring } from '@/lib/realtime/doorbell';

describe('ring (§7.5)', () => {
  it('posts one empty "changed" message to the round topic with the service key', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 202 }));
    await ring('r1', { fetchImpl, url: 'https://abc.supabase.co/', key: 'service-key' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://abc.supabase.co/realtime/v1/api/broadcast');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('apikey')).toBe('service-key');
    expect(JSON.parse(String(init.body))).toEqual({
      messages: [{ topic: 'draft:r1', event: 'changed', payload: {} }],
    });
    expect(draftTopic('r1')).toBe('draft:r1');
  });
  it('never throws: network errors and bad statuses are logged and ignored', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      ring('r1', { fetchImpl: vi.fn(async () => { throw new Error('offline'); }), url: 'https://x', key: 'k' }),
    ).resolves.toBeUndefined();
    await expect(
      ring('r1', { fetchImpl: vi.fn(async () => new Response('no', { status: 500 })), url: 'https://x', key: 'k' }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
  it('skips the call when Supabase settings are missing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = vi.fn();
    await ring('r1', { fetchImpl, url: undefined, key: 'k' });
    expect(fetchImpl).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/api/http.test.ts tests/draft/errors.test.ts tests/realtime/doorbell.test.ts`
Expected: FAIL — `code` missing from the body; the two new modules don't exist.

- [ ] **Step 3: Add `code` to `HttpError`**

In `lib/api/http.ts`:

```ts
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** A machine-readable reason the browser can switch on (for example the live-draft 409s). */
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
```

and in `handle()` replace the `HttpError` line with:

```ts
    if (err instanceof HttpError) {
      return json(err.code ? { error: err.message, code: err.code } : { error: err.message }, err.status);
    }
```

- [ ] **Step 4: Create `lib/draft/errors.ts`**

```ts
import { HttpError } from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import { draftPhase } from '@/lib/draft/live';

/** Spec §7.3 live-draft 409s. The first and last messages match v1's wording. */
export const DRAFT_ERRORS = {
  stale: 'Draft changed in another tab — refresh',
  not_your_turn: "It's not your turn",
  not_live: "The draft isn't running right now",
  taken: 'That team was just taken',
} as const;
export type DraftErrorCode = keyof typeof DRAFT_ERRORS;

export function draftError(code: DraftErrorCode): HttpError {
  return new HttpError(409, DRAFT_ERRORS[code], code);
}

/** draft_make_pick only says "no". Look at the draft again to say why. */
export async function classifyFailedPick(roundId: string, teamKey: string): Promise<HttpError> {
  const repo = getRepo();
  const [round, picks] = await Promise.all([repo.getRound(roundId), repo.listPicks(roundId)]);
  if (picks.some((p) => p.teamKey === teamKey)) return draftError('taken');
  if (!round || draftPhase(round, picks.length) !== 'live') return draftError('not_live');
  return draftError('stale');
}
```

- [ ] **Step 5: Create `lib/realtime/doorbell.ts`**

```ts
// Spec §7.5: after every live-draft change the server "rings" an empty broadcast. Phones that hear it
// refetch the draft state. The message carries no data, so a public channel leaks nothing.

export const DOORBELL_EVENT = 'changed';

export function draftTopic(roundId: string): string {
  return `draft:${roundId}`;
}

export type RingDeps = { fetchImpl: typeof fetch; url: string | undefined; key: string | undefined };

/** Never throws: polling on the phones covers a missed ring. */
export async function ring(roundId: string, deps: Partial<RingDeps> = {}): Promise<void> {
  const url = 'url' in deps ? deps.url : process.env.SUPABASE_URL;
  const key = 'key' in deps ? deps.key : process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('doorbell: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
    return;
  }
  try {
    const res = await (deps.fetchImpl ?? fetch)(`${url.replace(/\/+$/, '')}/realtime/v1/api/broadcast`, {
      method: 'POST',
      cache: 'no-store',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: draftTopic(roundId), event: DOORBELL_EVENT, payload: {} }] }),
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) console.error(`doorbell: broadcast answered ${res.status}`);
  } catch (err) {
    console.error('doorbell: broadcast failed', err);
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/api/http.test.ts tests/draft/errors.test.ts tests/realtime/doorbell.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/api/http.ts lib/draft/errors.ts lib/realtime/doorbell.ts tests/api/http.test.ts tests/draft/errors.test.ts tests/realtime/doorbell.test.ts
git commit -m "feat(draft): 409 codes, pick-failure classifier, and Realtime doorbell"
```

---

### Task 5: Pool entries, `GET …/pool`, and the shared route-test mocks

**Files:**
- Create: `lib/pool/entries.ts`
- Create: `app/api/l/[slug]/rounds/[id]/pool/route.ts`
- Create: `tests/helpers/draftMocks.ts`, `tests/helpers/draft.ts`
- Test: `tests/api/pool.test.ts` (new), `tests/pool/entries.test.ts` (new)

**Interfaces:**
- Consumes: v1 `loadPool(round, now)` → `{ teams: PoolTeam[]; stale; tbaCount }`; `Repo.listPicks`; SP1 `requireLeagueView(slug)`; `requireRound(league, id)` (`lib/api/http.ts`).
- Produces:
  - `type PoolEntry = { teamKey: string; nickname: string | null; proj: number | null; record: [number, number, number] | null; bestFinish: 'winner' | 'finalist' | 'captain' | 'picked' | null; opr: number | null; rank: number | null; available: boolean }`
  - `type PoolStats = Omit<PoolEntry, 'teamKey' | 'nickname' | 'available'>`
  - `type PoolStatsLookup = (teamKeys: string[], season: number) => Promise<Map<string, PoolStats>>`
  - `noPoolStats: PoolStatsLookup` (empty map), `activePoolStats: PoolStatsLookup` (= `noPoolStats`; **SP3 changes this one line** to its real lookup)
  - `buildPoolEntries(round: RoundRow, now: Date, stats?: PoolStatsLookup): Promise<PoolEntry[]>` (defaults to `activePoolStats`)
  - `GET /api/l/{slug}/rounds/{id}/pool` → `PoolEntry[]` (spec §6.3), visibility-checked
  - Test helpers: `mocks` + `dbModule`/`tbaModule`/`sessionModule`/`doorbellModule` (`tests/helpers/draftMocks.ts`); `seedLiveDraft(repo, opts)`, `TBA_TEAMS`, `T0` (`tests/helpers/draft.ts`)

- [ ] **Step 1: Create the shared test mocks**

Create `tests/helpers/draftMocks.ts`. Route tests import this module and point `vi.mock` factories at it, so the test and the mocked modules share one state object:

```ts
import { vi } from 'vitest';
import type { SessionUser } from '@/lib/auth/session';
import type { Repo } from '@/lib/db/repo';
import { TBA_TEAMS } from './draft';

export const mocks = {
  repo: undefined as unknown as Repo,
  user: null as SessionUser | null,
  getTba: vi.fn(),
  ring: vi.fn(async (_roundId: string) => {}),
};

/** Call in beforeEach. TBA knows eight teams at every event. */
export function resetDraftMocks(repo: Repo): void {
  mocks.repo = repo;
  mocks.user = null;
  mocks.getTba.mockReset();
  mocks.getTba.mockImplementation(async () => ({
    data: TBA_TEAMS,
    fetchedAt: '2026-10-23T22:00:00.000Z',
    stale: false,
  }));
  mocks.ring.mockClear();
}

export const dbModule = { getRepo: () => mocks.repo };
export const tbaModule = { getTba: (...args: unknown[]) => mocks.getTba(...args) };
export const doorbellModule = {
  ring: (roundId: string) => mocks.ring(roundId),
  draftTopic: (roundId: string) => `draft:${roundId}`,
  DOORBELL_EVENT: 'changed',
};
// Same behavior as SP1's lib/auth/session.ts, reading the user from `mocks`.
export const sessionModule = {
  getUser: async () => mocks.user,
  requireUser: async () => {
    if (!mocks.user) {
      const { HttpError } = await import('@/lib/api/http');
      throw new HttpError(401, 'Sign in first');
    }
    return mocks.user;
  },
};
```

Create `tests/helpers/draft.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Repo } from '@/lib/db/repo';
import type { DraftMode, PickSeconds } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { seedLeague } from './api';

export const TBA_TEAMS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
  key: `frc${n}`,
  team_number: n,
  nickname: `Team ${n}`,
}));

/** Draft night, 7 pm Eastern. */
export const T0 = new Date('2026-10-23T23:00:00.000Z');

/**
 * A league with Joey (commissioner, from SP1's seedLeague) and Mom (player), and a Ramp Riot round
 * with order [Joey, Mom], roster size 2, live mode, 60 s timer — unless opts say otherwise.
 */
export async function seedLiveDraft(
  repo: Repo,
  opts: { pickSeconds?: PickSeconds | null; rosterSize?: number; mode?: DraftMode; start?: boolean } = {},
) {
  const { league, commissioner: joey, user: joeyUser } = await seedLeague(repo);
  const momUser = { id: randomUUID(), email: 'mom@example.com' };
  const mom = await repo.createMember({ leagueId: league.id, userId: momUser.id, name: 'Mom', role: 'player' });
  const strangerUser = { id: randomUUID(), email: 'stranger@example.com' };
  const created = await repo.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
  });
  let round = await repo.updateRound(created.id, {
    draftOrder: [joey.id, mom.id],
    rosterSize: opts.rosterSize ?? 2,
    draftMode: opts.mode ?? 'live',
    pickSeconds: opts.pickSeconds === undefined ? 60 : opts.pickSeconds,
  });
  if (opts.start) {
    await repo.draftControl(round.id, 'start');
    round = (await repo.getRound(round.id))!;
  }
  return { league, round, joey, joeyUser, mom, momUser, strangerUser };
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/pool/entries.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks, resetDraftMocks } from '../helpers/draftMocks';

vi.mock('@/lib/db', async () => (await import('../helpers/draftMocks')).dbModule);
vi.mock('@/lib/tba/client', async () => (await import('../helpers/draftMocks')).tbaModule);

import { buildPoolEntries, noPoolStats, type PoolStatsLookup } from '@/lib/pool/entries';
import { seedLiveDraft, T0 } from '../helpers/draft';
import { createMemoryRepo } from '../helpers/memoryRepo';

beforeEach(() => resetDraftMocks(createMemoryRepo({ now: () => T0 })));

describe('buildPoolEntries', () => {
  it('lists every pool team with stats empty and taken teams unavailable', async () => {
    const { round, joey } = await seedLiveDraft(mocks.repo, { start: true });
    await mocks.repo.makePickAtomic({ roundId: round.id, pickNumber: 0, playerId: joey.id, teamKey: 'frc2', requireDue: false, auto: false });
    const entries = await buildPoolEntries(round, T0);
    expect(entries).toHaveLength(8);
    expect(entries[0]).toEqual({
      teamKey: 'frc1', nickname: 'Team 1', proj: null, record: null, bestFinish: null, opr: null, rank: null, available: true,
    });
    expect(entries.find((e) => e.teamKey === 'frc2')?.available).toBe(false);
    expect(await noPoolStats(['frc1'], 2025)).toEqual(new Map());
  });

  it('merges whatever a stats lookup returns, asking for the round season', async () => {
    const { round } = await seedLiveDraft(mocks.repo);
    const lookup: PoolStatsLookup = vi.fn(async () =>
      new Map([['frc1', { proj: 38.2, record: [8, 2, 0] as [number, number, number], bestFinish: 'winner' as const, opr: 41.5, rank: 1 }]]),
    );
    const entries = await buildPoolEntries(round, T0, lookup);
    expect(lookup).toHaveBeenCalledWith(expect.arrayContaining(['frc1', 'frc8']), 2025);
    expect(entries[0]).toMatchObject({ teamKey: 'frc1', proj: 38.2, bestFinish: 'winner', available: true });
    expect(entries[1].proj).toBeNull();
  });
});
```

Create `tests/api/pool.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks, resetDraftMocks } from '../helpers/draftMocks';

vi.mock('@/lib/db', async () => (await import('../helpers/draftMocks')).dbModule);
vi.mock('@/lib/tba/client', async () => (await import('../helpers/draftMocks')).tbaModule);
vi.mock('@/lib/auth/session', async () => (await import('../helpers/draftMocks')).sessionModule);

import { GET as getPool } from '@/app/api/l/[slug]/rounds/[id]/pool/route';
import { params, readJson, request } from '../helpers/api';
import { seedLiveDraft, T0 } from '../helpers/draft';
import { createMemoryRepo } from '../helpers/memoryRepo';

beforeEach(() => resetDraftMocks(createMemoryRepo({ now: () => T0 })));

const call = (slug: string, id: string) => getPool(request('GET', '/x'), params({ slug, id }));

describe('GET pool (§6.3)', () => {
  it('is open to anyone for link leagues', async () => {
    const { league, round } = await seedLiveDraft(mocks.repo);
    const res = await call(league.slug, round.id);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body).toHaveLength(8);
    expect(body[0]).toMatchObject({ teamKey: 'frc1', nickname: 'Team 1', proj: null, available: true });
  });

  it('is members-only for members leagues', async () => {
    const { league, round, momUser, strangerUser } = await seedLiveDraft(mocks.repo);
    await mocks.repo.updateLeague(league.id, { visibility: 'members' });
    expect((await call(league.slug, round.id)).status).toBe(403);
    mocks.user = strangerUser;
    expect((await call(league.slug, round.id)).status).toBe(403);
    mocks.user = momUser;
    expect((await call(league.slug, round.id)).status).toBe(200);
  });

  it('404s for unknown leagues, junk ids, and rounds of another league', async () => {
    const { league } = await seedLiveDraft(mocks.repo);
    expect((await call('nope', '00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await call(league.slug, 'not-a-uuid')).status).toBe(404);
  });
});
```

(`updateLeague(id, { visibility })` is SP1's `LeaguePatch.visibility`, SP1 Task 3.)

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/pool/entries.test.ts tests/api/pool.test.ts`
Expected: FAIL — `Cannot find module '@/lib/pool/entries'` / the route.

- [ ] **Step 4: Create `lib/pool/entries.ts`**

```ts
import { getRepo } from '@/lib/db';
import type { RoundRow } from '@/lib/db/types';
import { loadPool } from '@/lib/rounds/pool';

/** One row of the draft pool (spec §6.3). Stats are null until SP3 fills them ("New" in the UI). */
export type PoolEntry = {
  teamKey: string;
  nickname: string | null;
  proj: number | null;
  record: [number, number, number] | null;
  bestFinish: 'winner' | 'finalist' | 'captain' | 'picked' | null;
  opr: number | null;
  rank: number | null;
  available: boolean;
};
export type PoolStats = Omit<PoolEntry, 'teamKey' | 'nickname' | 'available'>;
export type PoolStatsLookup = (teamKeys: string[], season: number) => Promise<Map<string, PoolStats>>;

const NO_STATS: PoolStats = { proj: null, record: null, bestFinish: null, opr: null, rank: null };

export const noPoolStats: PoolStatsLookup = async () => new Map();

/** The stats source every caller uses. SP3 changes this one line to its team_stats lookup. */
export const activePoolStats: PoolStatsLookup = noPoolStats;

export async function buildPoolEntries(
  round: RoundRow,
  now: Date,
  stats: PoolStatsLookup = activePoolStats,
): Promise<PoolEntry[]> {
  const [pool, picks] = await Promise.all([loadPool(round, now), getRepo().listPicks(round.id)]);
  const taken = new Set(picks.map((p) => p.teamKey));
  const season = Number(round.startDate.slice(0, 4));
  const found = await stats(pool.teams.map((t) => t.teamKey), season);
  return pool.teams.map((t) => ({
    teamKey: t.teamKey,
    nickname: t.nickname,
    ...(found.get(t.teamKey) ?? NO_STATS),
    available: !taken.has(t.teamKey),
  }));
}
```

- [ ] **Step 5: Create the route**

Create `app/api/l/[slug]/rounds/[id]/pool/route.ts`:

```ts
import { handle, json, requireRound } from '@/lib/api/http';
import { requireLeagueView } from '@/lib/auth/roles';
import { buildPoolEntries } from '@/lib/pool/entries';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string }> };

/** Spec §6.3: the draft pool, for anyone who can view the league. */
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league } = await requireLeagueView(slug);
    const round = await requireRound(league, id);
    return json(await buildPoolEntries(round, new Date()));
  });
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/pool/entries.test.ts tests/api/pool.test.ts tests/config/dynamic-exports.test.ts`
Expected: PASS (the dynamic-exports test checks every new route exports `dynamic = 'force-dynamic'`).

- [ ] **Step 7: Commit**

```bash
git add lib/pool/entries.ts "app/api/l/[slug]/rounds/[id]/pool/route.ts" tests/helpers/draftMocks.ts tests/helpers/draft.ts tests/pool/entries.test.ts tests/api/pool.test.ts
git commit -m "feat(draft): pool entries with a stats seam and GET pool endpoint"
```

---

### Task 6: `advance` — keep the draft moving for auto-drafters

**Files:**
- Create: `lib/draft/advance.ts`
- Test: `tests/draft/advance.test.ts` (new)

**Interfaces:**
- Consumes: `draftPhase`, `onClockPlayer`, `chooseAutoPick` (Task 2); `Repo.makePickAtomic/getQueue/listAutodraftPlayers` (Task 3); `buildPoolEntries` (Task 5).
- Produces: `advance(roundId: string, now: Date): Promise<number>` — the number of auto-picks made. Callers (Tasks 8–11) run it after start, every pick, resume, undo, and auto-draft turned on, then `ring` once.

- [ ] **Step 1: Write the failing tests**

Create `tests/draft/advance.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks, resetDraftMocks } from '../helpers/draftMocks';

vi.mock('@/lib/db', async () => (await import('../helpers/draftMocks')).dbModule);
vi.mock('@/lib/tba/client', async () => (await import('../helpers/draftMocks')).tbaModule);

import { advance } from '@/lib/draft/advance';
import { seedLiveDraft, T0 } from '../helpers/draft';
import { createMemoryRepo } from '../helpers/memoryRepo';

beforeEach(() => resetDraftMocks(createMemoryRepo({ now: () => T0 })));

const teams = async (roundId: string) =>
  (await mocks.repo.listPicks(roundId)).map((p) => `${p.pickNumber}:${p.teamKey}:${p.auto ? 'auto' : 'hand'}`);

describe('advance (§7.4)', () => {
  it('first picker on auto-draft with the timer off: picks at once, then waits for Mom (Review Focus 2)', async () => {
    const { round, joey } = await seedLiveDraft(mocks.repo, { pickSeconds: null });
    await mocks.repo.setAutodraft(round.id, joey.id, true);
    await mocks.repo.draftControl(round.id, 'start');
    expect(await advance(round.id, T0)).toBe(1);
    expect(await teams(round.id)).toEqual(['0:frc1:auto']);
  });

  it('chains through every auto-drafter, using each queue first', async () => {
    const { round, joey, mom } = await seedLiveDraft(mocks.repo, { pickSeconds: null });
    await mocks.repo.setAutodraft(round.id, joey.id, true);
    await mocks.repo.setAutodraft(round.id, mom.id, true);
    await mocks.repo.setQueue(round.id, mom.id, ['frc7', 'frc1']);
    await mocks.repo.draftControl(round.id, 'start');
    expect(await advance(round.id, T0)).toBe(4);
    // Snake: Joey, Mom, Mom, Joey. Mom's queue: frc7, then frc1 is gone so she falls back to lowest number.
    expect(await teams(round.id)).toEqual(['0:frc1:auto', '1:frc7:auto', '2:frc2:auto', '3:frc3:auto']);
  });

  it('does nothing when the on-clock player is not on auto-draft', async () => {
    const { round, mom } = await seedLiveDraft(mocks.repo, { start: true });
    await mocks.repo.setAutodraft(round.id, mom.id, true);
    expect(await advance(round.id, T0)).toBe(0);
  });

  it('does nothing while paused or in commissioner mode', async () => {
    const paused = await seedLiveDraft(mocks.repo, { start: true });
    await mocks.repo.setAutodraft(paused.round.id, paused.joey.id, true);
    await mocks.repo.draftControl(paused.round.id, 'pause');
    expect(await advance(paused.round.id, T0)).toBe(0);

    resetDraftMocks(createMemoryRepo({ now: () => T0 }));
    const v1 = await seedLiveDraft(mocks.repo, { mode: 'commissioner' });
    await mocks.repo.setAutodraft(v1.round.id, v1.joey.id, true);
    expect(await advance(v1.round.id, T0)).toBe(0);
  });

  it('after resume onto an auto-drafter, picks for them', async () => {
    const { round, joey } = await seedLiveDraft(mocks.repo, { start: true });
    await mocks.repo.draftControl(round.id, 'pause');
    await mocks.repo.setAutodraft(round.id, joey.id, true);
    await mocks.repo.draftControl(round.id, 'resume');
    expect(await advance(round.id, T0)).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/draft/advance.test.ts`
Expected: FAIL — `Cannot find module '@/lib/draft/advance'`.

- [ ] **Step 3: Implement `lib/draft/advance.ts`**

```ts
import { getRepo } from '@/lib/db';
import { chooseAutoPick, draftPhase, onClockPlayer } from '@/lib/draft/live';
import { buildPoolEntries } from '@/lib/pool/entries';

/**
 * Spec §7.4: while the draft is live and the on-clock player has auto-draft on, pick for them.
 * Run after start, every pick, resume, undo, and auto-draft turned on. Returns the picks made.
 * Stops quietly if another request changes the draft (pause, pick, undo); that request runs advance too.
 */
export async function advance(roundId: string, now: Date): Promise<number> {
  const repo = getRepo();
  const round = await repo.getRound(roundId);
  if (!round || round.draftMode !== 'live') return 0;
  const [picks, autos] = await Promise.all([repo.listPicks(roundId), repo.listAutodraftPlayers(roundId)]);
  const onAuto = new Set(autos);
  let n = picks.length;
  if (draftPhase(round, n) !== 'live' || !onAuto.has(onClockPlayer(round, n) ?? '')) return 0;

  const pool = await buildPoolEntries(round, now);
  const taken = new Set(picks.map((p) => p.teamKey));
  let made = 0;
  for (;;) {
    const playerId = onClockPlayer(round, n);
    if (!playerId || !onAuto.has(playerId)) break;
    const available = pool.filter((e) => !taken.has(e.teamKey));
    const teamKey = chooseAutoPick(await repo.getQueue(roundId, playerId), available);
    if (!teamKey) break;
    const ok = await repo.makePickAtomic({
      roundId, pickNumber: n, playerId, teamKey, requireDue: false, auto: true,
    });
    if (!ok) break;
    taken.add(teamKey);
    n += 1;
    made += 1;
  }
  return made;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/draft/advance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/draft/advance.ts tests/draft/advance.test.ts
git commit -m "feat(draft): advance() auto-picks for auto-drafters on the clock"
```

---

### Task 7: Draft state — `GET …/draft/state`

**Files:**
- Create: `lib/draft/state.ts`
- Create: `app/api/l/[slug]/rounds/[id]/draft/state/route.ts`
- Test: `tests/api/draftState.test.ts` (new)

**Interfaces:**
- Consumes: SP1 `requireLeagueView(slug)` → `{ user, league, player }`; `Repo.listPlayers/listPicks/getQueue/getAutodraft/listAutodraftPlayers`; Task 2 helpers.
- Produces:
  - `type DraftState` (below) and `loadDraftState(round: RoundRow, viewer: PlayerRow | null, now: Date): Promise<DraftState>`
  - `GET /api/l/{slug}/rounds/{id}/draft/state` → `DraftState`; `me` only for members (spec §7.3).

```ts
export type DraftState = {
  phase: DraftPhase;
  draftMode: DraftMode;
  /** The next pick's 0-based number (= picks made so far). */
  pickNumber: number;
  totalPicks: number;
  onClock: { playerId: string; name: string } | null;
  deadline: string | null;
  serverNow: string;
  pickSeconds: PickSeconds | null;
  /** Time left when paused (null = full timer on resume, or no timer). */
  pausedRemainingMs: number | null;
  order: { playerId: string; name: string }[];
  rosterSize: number;
  picks: { pickNumber: number; playerId: string; teamKey: string; auto: boolean }[];
  autodraftPlayerIds: string[];
  me?: { playerId: string; isCommissioner: boolean; queue: string[]; autodraft: boolean };
};
```

- [ ] **Step 1: Write the failing test**

Create `tests/api/draftState.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks, resetDraftMocks } from '../helpers/draftMocks';

vi.mock('@/lib/db', async () => (await import('../helpers/draftMocks')).dbModule);
vi.mock('@/lib/tba/client', async () => (await import('../helpers/draftMocks')).tbaModule);
vi.mock('@/lib/auth/session', async () => (await import('../helpers/draftMocks')).sessionModule);

import { GET as getState } from '@/app/api/l/[slug]/rounds/[id]/draft/state/route';
import { params, readJson, request } from '../helpers/api';
import { seedLiveDraft, T0 } from '../helpers/draft';
import { createMemoryRepo } from '../helpers/memoryRepo';

beforeEach(() => resetDraftMocks(createMemoryRepo({ now: () => T0 })));

const call = (slug: string, id: string) => getState(request('GET', '/x'), params({ slug, id }));

describe('GET draft/state (§7.3)', () => {
  it('shows the draft to a signed-out viewer of a link league, without "me"', async () => {
    const { league, round, joey, mom } = await seedLiveDraft(mocks.repo, { start: true });
    const res = await call(league.slug, round.id);
    expect(res.status).toBe(200);
    const s = await readJson(res);
    expect(s).toMatchObject({
      phase: 'live', draftMode: 'live', pickNumber: 0, totalPicks: 4, pickSeconds: 60,
      onClock: { playerId: joey.id, name: joey.name },
      deadline: new Date(T0.getTime() + 60_000).toISOString(),
      order: [{ playerId: joey.id, name: joey.name }, { playerId: mom.id, name: 'Mom' }],
      rosterSize: 2, picks: [], autodraftPlayerIds: [],
    });
    expect(typeof s.serverNow).toBe('string');
    expect(s.me).toBeUndefined();
  });

  it('adds my queue, auto-draft, and role for a member', async () => {
    const { league, round, mom, momUser } = await seedLiveDraft(mocks.repo, { start: true });
    await mocks.repo.setQueue(round.id, mom.id, ['frc4', 'frc2']);
    await mocks.repo.setAutodraft(round.id, mom.id, true);
    mocks.user = momUser;
    const s = await readJson(await call(league.slug, round.id));
    expect(s.me).toEqual({ playerId: mom.id, isCommissioner: false, queue: ['frc4', 'frc2'], autodraft: true });
    expect(s.autodraftPlayerIds).toEqual([mom.id]);
  });

  it('is setup before start and paused while paused', async () => {
    const { league, round } = await seedLiveDraft(mocks.repo);
    expect((await readJson(await call(league.slug, round.id))).phase).toBe('setup');
    await mocks.repo.draftControl(round.id, 'start');
    await mocks.repo.draftControl(round.id, 'pause');
    const s = await readJson(await call(league.slug, round.id));
    expect(s).toMatchObject({ phase: 'paused', deadline: null, pausedRemainingMs: 60_000 });
  });

  it('403s a non-member of a members-only league', async () => {
    const { league, round, strangerUser } = await seedLiveDraft(mocks.repo);
    await mocks.repo.updateLeague(league.id, { visibility: 'members' });
    mocks.user = strangerUser;
    expect((await call(league.slug, round.id)).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/api/draftState.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement `lib/draft/state.ts`**

```ts
import { getRepo } from '@/lib/db';
import type { DraftMode, PickSeconds, PlayerRow, RoundRow } from '@/lib/db/types';
import { draftPhase, onClockPlayer, totalPicks, type DraftPhase } from '@/lib/draft/live';

export type DraftState = {
  phase: DraftPhase;
  draftMode: DraftMode;
  /** The next pick's 0-based number (= picks made so far). */
  pickNumber: number;
  totalPicks: number;
  onClock: { playerId: string; name: string } | null;
  deadline: string | null;
  serverNow: string;
  pickSeconds: PickSeconds | null;
  /** Time left when paused (null = full timer on resume, or no timer). */
  pausedRemainingMs: number | null;
  order: { playerId: string; name: string }[];
  rosterSize: number;
  picks: { pickNumber: number; playerId: string; teamKey: string; auto: boolean }[];
  autodraftPlayerIds: string[];
  me?: { playerId: string; isCommissioner: boolean; queue: string[]; autodraft: boolean };
};

/** Everything a phone needs to draw the draft room (spec §7.3). `viewer` is null for non-members. */
export async function loadDraftState(round: RoundRow, viewer: PlayerRow | null, now: Date): Promise<DraftState> {
  const repo = getRepo();
  const [players, picks, autos] = await Promise.all([
    repo.listPlayers(round.leagueId),
    repo.listPicks(round.id),
    repo.listAutodraftPlayers(round.id),
  ]);
  const names = new Map(players.map((p) => [p.id, p.name]));
  const nameOf = (id: string) => names.get(id) ?? 'Unknown';
  const onClockId = onClockPlayer(round, picks.length);
  const phase = draftPhase(round, picks.length);

  const state: DraftState = {
    phase,
    draftMode: round.draftMode,
    pickNumber: picks.length,
    totalPicks: totalPicks(round),
    onClock: onClockId && phase !== 'setup' ? { playerId: onClockId, name: nameOf(onClockId) } : null,
    deadline: phase === 'live' ? round.pickDeadline : null,
    serverNow: now.toISOString(),
    pickSeconds: round.pickSeconds,
    pausedRemainingMs:
      phase !== 'paused'
        ? null
        : (round.pausedRemainingMs ?? (round.pickSeconds === null ? null : round.pickSeconds * 1000)),
    order: round.draftOrder.map((id) => ({ playerId: id, name: nameOf(id) })),
    rosterSize: round.rosterSize,
    picks: picks.map((p) => ({ pickNumber: p.pickNumber, playerId: p.playerId, teamKey: p.teamKey, auto: p.auto })),
    autodraftPlayerIds: autos,
  };
  if (viewer) {
    const [queue, autodraft] = await Promise.all([
      repo.getQueue(round.id, viewer.id),
      repo.getAutodraft(round.id, viewer.id),
    ]);
    state.me = { playerId: viewer.id, isCommissioner: viewer.role === 'commissioner', queue, autodraft };
  }
  return state;
}
```

(The paused `pausedRemainingMs` shows the full timer when the remaining time was cleared, so the banner can say "Paused · 1:00 left"; `null` when there's no timer.)

- [ ] **Step 4: Create the route**

Create `app/api/l/[slug]/rounds/[id]/draft/state/route.ts`:

```ts
import { handle, json, requireRound } from '@/lib/api/http';
import { requireLeagueView } from '@/lib/auth/roles';
import { loadDraftState } from '@/lib/draft/state';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league, player } = await requireLeagueView(slug);
    const round = await requireRound(league, id);
    return json(await loadDraftState(round, player, new Date()));
  });
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/api/draftState.test.ts tests/config/dynamic-exports.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/draft/state.ts "app/api/l/[slug]/rounds/[id]/draft/state/route.ts" tests/api/draftState.test.ts
git commit -m "feat(draft): GET draft/state with per-member queue and auto-draft"
```

---

### Task 8: Player picks and timeouts — `POST …/draft/pick` and `POST …/draft/tick`

**Files:**
- Create: `app/api/l/[slug]/rounds/[id]/draft/pick/route.ts`
- Create: `app/api/l/[slug]/rounds/[id]/draft/tick/route.ts`
- Test: `tests/api/draftPick.test.ts` (new)

**Interfaces:**
- Consumes: SP1 `requireLeagueRole(slug, 'player')` → `{ league, player }`; `requireRound`, `parseBody`, `HttpError` (`lib/api/http.ts`); `loadPool` (v1); `draftPhase`, `onClockPlayer`, `chooseAutoPick` (Task 2); `makePickAtomic`, `getQueue` (Task 3); `draftError`, `classifyFailedPick`, `ring` (Task 4); `buildPoolEntries` (Task 5); `advance` (Task 6).
- Produces:
  - `POST /api/l/{slug}/rounds/{id}/draft/pick { expectedPickNumber, teamKey }` → 201 `{ pick: { pickNumber, playerId, teamKey } }`; 409 `{ error, code }` with `not_your_turn` / `stale` / `taken` / `not_live`; 400 not in the pool.
  - `POST /api/l/{slug}/rounds/{id}/draft/tick { expectedPickNumber }` → 200 `{ picked: boolean }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/draftPick.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks, resetDraftMocks } from '../helpers/draftMocks';

vi.mock('@/lib/db', async () => (await import('../helpers/draftMocks')).dbModule);
vi.mock('@/lib/tba/client', async () => (await import('../helpers/draftMocks')).tbaModule);
vi.mock('@/lib/auth/session', async () => (await import('../helpers/draftMocks')).sessionModule);
vi.mock('@/lib/realtime/doorbell', async () => (await import('../helpers/draftMocks')).doorbellModule);

import { POST as pickRoute } from '@/app/api/l/[slug]/rounds/[id]/draft/pick/route';
import { POST as tickRoute } from '@/app/api/l/[slug]/rounds/[id]/draft/tick/route';
import { createMemoryRepo } from '../helpers/memoryRepo';
import { params, readJson, request } from '../helpers/api';
import { seedLiveDraft, T0 } from '../helpers/draft';

const clock = { now: T0 };
beforeEach(() => {
  clock.now = T0;
  resetDraftMocks(createMemoryRepo({ now: () => clock.now }));
});
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

type Seeded = Awaited<ReturnType<typeof seedLiveDraft>>;
const pick = (s: Seeded, expectedPickNumber: number, teamKey: string) =>
  pickRoute(request('POST', '/x', { body: { expectedPickNumber, teamKey } }), params({ slug: s.league.slug, id: s.round.id }));
const tick = (s: Seeded, expectedPickNumber: number) =>
  tickRoute(request('POST', '/x', { body: { expectedPickNumber } }), params({ slug: s.league.slug, id: s.round.id }));
const codeOf = async (res: Response) => [res.status, (await readJson(res)).code];

describe('POST draft/pick (§7.3)', () => {
  it('lets the on-clock member pick, moves the deadline, and rings once', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    clock.now = later(12);
    const res = await pick(s, 0, 'frc3');
    expect(res.status).toBe(201);
    expect(await readJson(res)).toEqual({ pick: { pickNumber: 0, playerId: s.joey.id, teamKey: 'frc3' } });
    expect((await mocks.repo.getRound(s.round.id))!.pickDeadline).toBe(later(72).toISOString());
    expect(mocks.ring).toHaveBeenCalledTimes(1);
    expect(mocks.ring).toHaveBeenCalledWith(s.round.id);
  });

  it('refuses the wrong player, a stale number, and a taken team with the right codes', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.momUser;
    expect(await codeOf(await pick(s, 0, 'frc1'))).toEqual([409, 'not_your_turn']);
    mocks.user = s.joeyUser;
    expect(await codeOf(await pick(s, 3, 'frc1'))).toEqual([409, 'stale']);
    await pick(s, 0, 'frc1');
    mocks.user = s.momUser;
    expect(await codeOf(await pick(s, 1, 'frc1'))).toEqual([409, 'taken']);
    expect(mocks.ring).toHaveBeenCalledTimes(1);
  });

  it('a double tap from two phones: one 201, one clean 409 (Review Focus 1)', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    const [a, b] = await Promise.all([pick(s, 0, 'frc1'), pick(s, 0, 'frc2')]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(['stale', 'taken']).toContain((await readJson(loser)).code);
    expect(await mocks.repo.listPicks(s.round.id)).toHaveLength(1);
  });

  it('refuses when not live: before start, while paused, commissioner mode', async () => {
    const s = await seedLiveDraft(mocks.repo);
    mocks.user = s.joeyUser;
    expect(await codeOf(await pick(s, 0, 'frc1'))).toEqual([409, 'not_live']);
    await mocks.repo.draftControl(s.round.id, 'start');
    await mocks.repo.draftControl(s.round.id, 'pause');
    expect(await codeOf(await pick(s, 0, 'frc1'))).toEqual([409, 'not_live']);
  });

  it('400s a team outside the pool and bad bodies', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    expect((await pick(s, 0, 'frc9999')).status).toBe(400);
    expect((await pick(s, -1, 'frc1')).status).toBe(400);
    expect((await pick(s, 0, 'team341')).status).toBe(400);
  });

  it('401 signed out, 403 for a stranger', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    expect((await pick(s, 0, 'frc1')).status).toBe(401);
    mocks.user = s.strangerUser;
    expect((await pick(s, 0, 'frc1')).status).toBe(403);
  });

  it('after a pick, auto-drafters on the clock are picked for right away', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    await mocks.repo.setAutodraft(s.round.id, s.mom.id, true);
    mocks.user = s.joeyUser;
    await pick(s, 0, 'frc5');
    // Snake [Joey, Mom]: Mom has picks 1 and 2, both auto (lowest numbers first).
    expect((await mocks.repo.listPicks(s.round.id)).map((p) => [p.teamKey, p.auto])).toEqual([
      ['frc5', false], ['frc1', true], ['frc2', true],
    ]);
  });
});

describe('POST draft/tick (§7.4)', () => {
  it('does nothing before the database deadline, even if a phone thinks time is up (Review Focus 4)', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true, pickSeconds: 30 });
    mocks.user = s.momUser;
    clock.now = later(29);
    const res = await tick(s, 0);
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ picked: false });
    expect(await mocks.repo.listPicks(s.round.id)).toHaveLength(0);
    expect(mocks.ring).not.toHaveBeenCalled();
  });

  it('after the deadline, auto-picks for the on-clock player from their queue', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true, pickSeconds: 30 });
    await mocks.repo.setQueue(s.round.id, s.joey.id, ['frc6']);
    mocks.user = s.momUser; // anyone in the league may send the tick
    clock.now = later(31);
    expect(await readJson(await tick(s, 0))).toEqual({ picked: true });
    expect(await mocks.repo.listPicks(s.round.id)).toMatchObject([{ pickNumber: 0, playerId: s.joey.id, teamKey: 'frc6', auto: true }]);
    expect(mocks.ring).toHaveBeenCalledTimes(1);
    // A second phone's tick for the same pick is a no-op.
    expect(await readJson(await tick(s, 0))).toEqual({ picked: false });
  });

  it('never fires with the timer off, and needs membership', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true, pickSeconds: null });
    mocks.user = s.momUser;
    clock.now = later(3600);
    expect(await readJson(await tick(s, 0))).toEqual({ picked: false });
    mocks.user = null;
    expect((await tick(s, 0)).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/api/draftPick.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Create the pick route**

Create `app/api/l/[slug]/rounds/[id]/draft/pick/route.ts`:

```ts
import { z } from 'zod';
import { handle, HttpError, json, parseBody, requireRound } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { advance } from '@/lib/draft/advance';
import { classifyFailedPick, draftError } from '@/lib/draft/errors';
import { draftPhase, onClockPlayer } from '@/lib/draft/live';
import { ring } from '@/lib/realtime/doorbell';
import { loadPool } from '@/lib/rounds/pool';
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

/** Spec §7.3: a member makes their own pick in a live draft. */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league, player } = await requireLeagueRole(slug, 'player');
    const round = await requireRound(league, id);
    const { expectedPickNumber, teamKey } = await parseBody(req, bodySchema);
    const repo = getRepo();
    const now = new Date();

    const picks = await repo.listPicks(round.id);
    if (draftPhase(round, picks.length) !== 'live') throw draftError('not_live');
    if (expectedPickNumber !== picks.length) throw draftError('stale');
    if (onClockPlayer(round, picks.length) !== player.id) throw draftError('not_your_turn');
    const pool = await loadPool(round, now);
    if (!pool.teams.some((t) => t.teamKey === teamKey)) {
      throw new HttpError(400, "That team isn't in this event's team pool");
    }
    if (picks.some((p) => p.teamKey === teamKey)) throw draftError('taken');

    const ok = await repo.makePickAtomic({
      roundId: round.id, pickNumber: expectedPickNumber, playerId: player.id, teamKey, requireDue: false, auto: false,
    });
    if (!ok) throw await classifyFailedPick(round.id, teamKey);

    await advance(round.id, now);
    await ring(round.id);
    return json({ pick: { pickNumber: expectedPickNumber, playerId: player.id, teamKey } }, 201);
  });
}
```

- [ ] **Step 4: Create the tick route**

Create `app/api/l/[slug]/rounds/[id]/draft/tick/route.ts`:

```ts
import { z } from 'zod';
import { handle, json, parseBody, requireRound } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { advance } from '@/lib/draft/advance';
import { chooseAutoPick, draftPhase, onClockPlayer } from '@/lib/draft/live';
import { buildPoolEntries } from '@/lib/pool/entries';
import { ring } from '@/lib/realtime/doorbell';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string }> };

const bodySchema = z.object({
  expectedPickNumber: z
    .number('expectedPickNumber must be a whole number, 0 or more')
    .int('expectedPickNumber must be a whole number, 0 or more')
    .min(0, 'expectedPickNumber must be a whole number, 0 or more'),
});

/**
 * Spec §7.4 timeout: any member's phone calls this once its corrected clock passes deadline + 500 ms.
 * The database clock has the final say (p_require_due), so a phone with a fast clock can't cut a turn short.
 */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'player');
    const round = await requireRound(league, id);
    const { expectedPickNumber } = await parseBody(req, bodySchema);
    const repo = getRepo();
    const now = new Date();

    const picks = await repo.listPicks(round.id);
    const playerId = onClockPlayer(round, picks.length);
    if (
      draftPhase(round, picks.length) !== 'live' ||
      expectedPickNumber !== picks.length ||
      round.pickSeconds === null ||
      !round.pickDeadline ||
      !playerId
    ) {
      return json({ picked: false });
    }

    const [pool, queue] = await Promise.all([buildPoolEntries(round, now), repo.getQueue(round.id, playerId)]);
    const teamKey = chooseAutoPick(queue, pool.filter((e) => e.available));
    if (!teamKey) return json({ picked: false });

    const picked = await repo.makePickAtomic({
      roundId: round.id, pickNumber: expectedPickNumber, playerId, teamKey, requireDue: true, auto: true,
    });
    if (picked) {
      await advance(round.id, now);
      await ring(round.id);
    }
    return json({ picked });
  });
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/api/draftPick.test.ts tests/config/dynamic-exports.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/api/l/[slug]/rounds/[id]/draft/pick/route.ts" "app/api/l/[slug]/rounds/[id]/draft/tick/route.ts" tests/api/draftPick.test.ts
git commit -m "feat(draft): member picks and timeout ticks through draft_make_pick"
```

---

### Task 9: My queue and auto-draft — `PUT …/draft/queue` and `PUT …/draft/autodraft`

**Files:**
- Create: `app/api/l/[slug]/rounds/[id]/draft/queue/route.ts`
- Create: `app/api/l/[slug]/rounds/[id]/draft/autodraft/route.ts`
- Test: `tests/api/draftQueue.test.ts` (new)

**Interfaces:**
- Consumes: as Task 8, plus `Repo.setQueue/setAutodraft` (Task 3).
- Produces:
  - `PUT /api/l/{slug}/rounds/{id}/draft/queue { teamKeys: string[] }` → 200 `{ queue: string[] }` (≤ 100, no duplicates, all in the pool; 400 otherwise; 409 once the draft is done).
  - `PUT /api/l/{slug}/rounds/{id}/draft/autodraft { on: boolean }` → 200 `{ autodraft: boolean, picked: number }` (`picked` = auto-picks `advance` made because I was on the clock).

- [ ] **Step 1: Write the failing tests**

Create `tests/api/draftQueue.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks, resetDraftMocks } from '../helpers/draftMocks';

vi.mock('@/lib/db', async () => (await import('../helpers/draftMocks')).dbModule);
vi.mock('@/lib/tba/client', async () => (await import('../helpers/draftMocks')).tbaModule);
vi.mock('@/lib/auth/session', async () => (await import('../helpers/draftMocks')).sessionModule);
vi.mock('@/lib/realtime/doorbell', async () => (await import('../helpers/draftMocks')).doorbellModule);

import { PUT as autodraftRoute } from '@/app/api/l/[slug]/rounds/[id]/draft/autodraft/route';
import { PUT as queueRoute } from '@/app/api/l/[slug]/rounds/[id]/draft/queue/route';
import { params, readJson, request } from '../helpers/api';
import { seedLiveDraft, T0 } from '../helpers/draft';
import { createMemoryRepo } from '../helpers/memoryRepo';

beforeEach(() => resetDraftMocks(createMemoryRepo({ now: () => T0 })));

type Seeded = Awaited<ReturnType<typeof seedLiveDraft>>;
const putQueue = (s: Seeded, teamKeys: unknown) =>
  queueRoute(request('PUT', '/x', { body: { teamKeys } }), params({ slug: s.league.slug, id: s.round.id }));
const putAuto = (s: Seeded, on: unknown) =>
  autodraftRoute(request('PUT', '/x', { body: { on } }), params({ slug: s.league.slug, id: s.round.id }));

describe('PUT draft/queue', () => {
  it('replaces my whole queue, before or during the draft', async () => {
    const s = await seedLiveDraft(mocks.repo);
    mocks.user = s.momUser;
    await putQueue(s, ['frc3', 'frc1']);
    const res = await putQueue(s, ['frc8', 'frc3']);
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ queue: ['frc8', 'frc3'] });
    expect(await mocks.repo.getQueue(s.round.id, s.mom.id)).toEqual(['frc8', 'frc3']);
    expect(await mocks.repo.getQueue(s.round.id, s.joey.id)).toEqual([]);
  });

  it('rejects duplicates, teams outside the pool, and more than 100 teams', async () => {
    const s = await seedLiveDraft(mocks.repo);
    mocks.user = s.momUser;
    expect((await putQueue(s, ['frc1', 'frc1'])).status).toBe(400);
    expect((await putQueue(s, ['frc9999'])).status).toBe(400);
    const tooMany = Array.from({ length: 101 }, (_, i) => `frc${i + 1}`);
    expect((await putQueue(s, tooMany)).status).toBe(400);
    expect((await putQueue(s, 'frc1')).status).toBe(400);
  });

  it('needs membership', async () => {
    const s = await seedLiveDraft(mocks.repo);
    expect((await putQueue(s, [])).status).toBe(401);
    mocks.user = s.strangerUser;
    expect((await putQueue(s, [])).status).toBe(403);
  });
});

describe('PUT draft/autodraft', () => {
  it('stores my choice and rings', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.momUser;
    expect(await readJson(await putAuto(s, true))).toEqual({ autodraft: true, picked: 0 });
    expect(await mocks.repo.getAutodraft(s.round.id, s.mom.id)).toBe(true);
    expect(mocks.ring).toHaveBeenCalledTimes(1);
  });

  it('turning it on while I am on the clock picks for me at once', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    expect(await readJson(await putAuto(s, true))).toEqual({ autodraft: true, picked: 1 });
    expect((await mocks.repo.listPicks(s.round.id))[0]).toMatchObject({ playerId: s.joey.id, auto: true });
  });

  it('400s a non-boolean', async () => {
    const s = await seedLiveDraft(mocks.repo);
    mocks.user = s.momUser;
    expect((await putAuto(s, 'yes')).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/api/draftQueue.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Create the queue route**

Create `app/api/l/[slug]/rounds/[id]/draft/queue/route.ts`:

```ts
import { z } from 'zod';
import { handle, HttpError, json, parseBody, requireRound } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { draftPhase } from '@/lib/draft/live';
import { ring } from '@/lib/realtime/doorbell';
import { loadPool } from '@/lib/rounds/pool';
import { TEAM_KEY_RE, teamLabel } from '@/lib/teams';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string }> };

// Not exported: a route file may only export handlers and route config (Next.js build rule).
const MAX_QUEUE = 100;

const bodySchema = z.object({
  teamKeys: z
    .array(z.string().regex(TEAM_KEY_RE, 'Team keys look like frc341'), 'teamKeys must be a list of team keys')
    .max(MAX_QUEUE, `A queue can hold at most ${MAX_QUEUE} teams`)
    .refine((keys) => new Set(keys).size === keys.length, { message: 'A team can only be in your queue once' }),
});

/** Spec §7.3: replaces my whole draft queue. */
export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league, player } = await requireLeagueRole(slug, 'player');
    const round = await requireRound(league, id);
    const { teamKeys } = await parseBody(req, bodySchema);
    const repo = getRepo();

    const picks = await repo.listPicks(round.id);
    if (draftPhase(round, picks.length) === 'done') throw new HttpError(409, 'The draft is over');
    const pool = new Set((await loadPool(round, new Date())).teams.map((t) => t.teamKey));
    const outside = teamKeys.find((k) => !pool.has(k));
    if (outside) throw new HttpError(400, `${teamLabel(outside)} isn't in this event's team pool`);

    await repo.setQueue(round.id, player.id, teamKeys);
    await ring(round.id);
    return json({ queue: teamKeys });
  });
}
```

- [ ] **Step 4: Create the auto-draft route**

Create `app/api/l/[slug]/rounds/[id]/draft/autodraft/route.ts`:

```ts
import { z } from 'zod';
import { handle, json, parseBody, requireRound } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { advance } from '@/lib/draft/advance';
import { ring } from '@/lib/realtime/doorbell';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string }> };

const bodySchema = z.object({ on: z.boolean('on must be true or false') });

/** Spec §7.3 "Auto-draft for me". Turning it on while on the clock picks right away (§7.4). */
export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league, player } = await requireLeagueRole(slug, 'player');
    const round = await requireRound(league, id);
    const { on } = await parseBody(req, bodySchema);

    await getRepo().setAutodraft(round.id, player.id, on);
    const picked = on ? await advance(round.id, new Date()) : 0;
    await ring(round.id);
    return json({ autodraft: on, picked });
  });
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/api/draftQueue.test.ts tests/config/dynamic-exports.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/api/l/[slug]/rounds/[id]/draft/queue/route.ts" "app/api/l/[slug]/rounds/[id]/draft/autodraft/route.ts" tests/api/draftQueue.test.ts
git commit -m "feat(draft): draft queue and auto-draft endpoints"
```

---

### Task 10: Commissioner draft controls — PATCH `draftMode`/`pickSeconds`, and start / pause / resume

**Files:**
- Modify: `app/api/l/[slug]/admin/rounds/[id]/route.ts` (PATCH)
- Create: `app/api/l/[slug]/admin/rounds/[id]/draft/[action]/route.ts` (serves `/draft/start`, `/draft/pause`, `/draft/resume`)
- Test: `tests/api/draftAdmin.test.ts` (new)

**Interfaces:**
- Consumes: SP1 `requireLeagueRole(slug, 'commissioner')`; `Repo.draftControl` (Task 3); `advance` (Task 6); `ring` (Task 4); `loadDraftState` (Task 7); v1 `loadPool`.
- Produces:
  - PATCH `/api/l/{slug}/admin/rounds/{id}` accepts `draftMode?: 'commissioner' | 'live'` (409 once started or once any pick exists) and `pickSeconds?: 30 | 60 | 90 | 120 | null` (409 while a started draft is running; while paused it also clears `pausedRemainingMs` so resume gives the full new timer). `draftOrder`/`rosterSize` changes 409 once a live draft has started.
  - POST `/api/l/{slug}/admin/rounds/{id}/draft/start` → 200 `DraftState`; 409 not live mode / already started / empty order / `P × R > T`.
  - POST `…/draft/pause` → 200 `DraftState`; 409 unless live. POST `…/draft/resume` → 200 `DraftState`; 409 unless paused. Unknown action → 404.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/draftAdmin.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks, resetDraftMocks } from '../helpers/draftMocks';

vi.mock('@/lib/db', async () => (await import('../helpers/draftMocks')).dbModule);
vi.mock('@/lib/tba/client', async () => (await import('../helpers/draftMocks')).tbaModule);
vi.mock('@/lib/auth/session', async () => (await import('../helpers/draftMocks')).sessionModule);
vi.mock('@/lib/realtime/doorbell', async () => (await import('../helpers/draftMocks')).doorbellModule);

import { POST as controlRoute } from '@/app/api/l/[slug]/admin/rounds/[id]/draft/[action]/route';
import { PATCH as patchRound } from '@/app/api/l/[slug]/admin/rounds/[id]/route';
import { params, readJson, request } from '../helpers/api';
import { seedLiveDraft, T0 } from '../helpers/draft';
import { createMemoryRepo } from '../helpers/memoryRepo';

const clock = { now: T0 };
beforeEach(() => {
  clock.now = T0;
  resetDraftMocks(createMemoryRepo({ now: () => clock.now }));
});
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

type Seeded = Awaited<ReturnType<typeof seedLiveDraft>>;
const control = (s: Seeded, action: string) =>
  controlRoute(request('POST', '/x'), params({ slug: s.league.slug, id: s.round.id, action }));
const patch = (s: Seeded, body: unknown) =>
  patchRound(request('PATCH', '/x', { body }), params({ slug: s.league.slug, id: s.round.id }));
const reload = async (s: Seeded) => (await mocks.repo.getRound(s.round.id))!;

describe('PATCH round draft settings (§7.3)', () => {
  it('switches draft mode and timer before the draft starts', async () => {
    const s = await seedLiveDraft(mocks.repo, { mode: 'commissioner', pickSeconds: null });
    mocks.user = s.joeyUser;
    expect((await patch(s, { draftMode: 'live', pickSeconds: 90 })).status).toBe(200);
    expect(await reload(s)).toMatchObject({ draftMode: 'live', pickSeconds: 90 });
    expect((await patch(s, { pickSeconds: 45 })).status).toBe(400);
  });

  it('locks draft mode, order, and a running timer once started', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    expect((await patch(s, { draftMode: 'commissioner' })).status).toBe(409);
    expect((await patch(s, { rosterSize: 3 })).status).toBe(409);
    expect((await patch(s, { pickSeconds: 30 })).status).toBe(409);
  });

  it('refuses a mode switch once commissioner-mode picks exist', async () => {
    const s = await seedLiveDraft(mocks.repo, { mode: 'commissioner' });
    await mocks.repo.insertPick({ roundId: s.round.id, pickNumber: 0, playerId: s.joey.id, teamKey: 'frc1' });
    mocks.user = s.joeyUser;
    expect((await patch(s, { draftMode: 'live' })).status).toBe(409);
  });

  it('changing the timer while paused gives the full new timer on resume (§7.1)', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true, pickSeconds: 30 });
    mocks.user = s.joeyUser;
    clock.now = later(20);
    await control(s, 'pause');
    expect((await patch(s, { pickSeconds: 120 })).status).toBe(200);
    expect((await reload(s)).pausedRemainingMs).toBeNull();
    await control(s, 'resume');
    expect((await reload(s)).pickDeadline).toBe(later(140).toISOString());
  });

  it('only commissioners', async () => {
    const s = await seedLiveDraft(mocks.repo);
    mocks.user = s.momUser;
    expect((await patch(s, { pickSeconds: 30 })).status).toBe(403);
  });
});

describe('draft start / pause / resume', () => {
  it('starts a ready live draft, rings, and returns the state', async () => {
    const s = await seedLiveDraft(mocks.repo);
    mocks.user = s.joeyUser;
    const res = await control(s, 'start');
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({ phase: 'live', pickNumber: 0, deadline: later(60).toISOString() });
    expect(mocks.ring).toHaveBeenCalledTimes(1);
    expect((await control(s, 'start')).status).toBe(409);
  });

  it('refuses to start commissioner-mode rounds, empty orders, and too-small pools', async () => {
    const v1 = await seedLiveDraft(mocks.repo, { mode: 'commissioner' });
    mocks.user = v1.joeyUser;
    expect((await control(v1, 'start')).status).toBe(409);

    resetDraftMocks(createMemoryRepo({ now: () => clock.now }));
    const big = await seedLiveDraft(mocks.repo, { rosterSize: 5 }); // 2 players × 5 > 8 teams
    mocks.user = big.joeyUser;
    const res = await control(big, 'start');
    expect(res.status).toBe(409);
    expect((await readJson(res)).error).toBe('With 2 players and 8 teams, roster size can be at most 4');

    await mocks.repo.updateRound(big.round.id, { draftOrder: [], rosterSize: 2 });
    expect((await readJson(await control(big, 'start'))).error).toBe('Set the draft order before drafting');
  });

  it('first picker on auto-draft: start picks for them at once (Review Focus 2)', async () => {
    const s = await seedLiveDraft(mocks.repo, { pickSeconds: null });
    await mocks.repo.setAutodraft(s.round.id, s.joey.id, true);
    mocks.user = s.joeyUser;
    const state = await readJson(await control(s, 'start'));
    expect(state.pickNumber).toBe(1);
    expect(state.picks[0]).toMatchObject({ playerId: s.joey.id, auto: true });
  });

  it('pauses and resumes, keeping the time left', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    expect((await control(s, 'resume')).status).toBe(409);
    clock.now = later(15);
    expect(await readJson(await control(s, 'pause'))).toMatchObject({ phase: 'paused', pausedRemainingMs: 45_000 });
    expect((await control(s, 'pause')).status).toBe(409);
    clock.now = later(600);
    // Resumed at T0+600 with 45 s left.
    expect(await readJson(await control(s, 'resume'))).toMatchObject({ phase: 'live', deadline: later(645).toISOString() });
    expect(mocks.ring).toHaveBeenCalledTimes(2);
  });

  it('404s an unknown action and 403s players', async () => {
    const s = await seedLiveDraft(mocks.repo);
    mocks.user = s.joeyUser;
    expect((await control(s, 'explode')).status).toBe(404);
    mocks.user = s.momUser;
    expect((await control(s, 'start')).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/api/draftAdmin.test.ts`
Expected: FAIL — the `[action]` route doesn't exist; PATCH rejects `draftMode` as an unknown key.

- [ ] **Step 3: Extend PATCH**

In `app/api/l/[slug]/admin/rounds/[id]/route.ts` (already on `requireLeagueRole(slug, 'commissioner')` since SP1):

Add to `patchSchema`'s object (before `.refine`):

```ts
    draftMode: z.enum(['commissioner', 'live'], 'draftMode must be commissioner or live').optional(),
    pickSeconds: z
      .union([z.literal(30), z.literal(60), z.literal(90), z.literal(120), z.null()], {
        error: 'The pick timer must be off, 30, 60, 90, or 120 seconds',
      })
      .optional(),
```

In `PATCH`, right after `const now = new Date();` add:

```ts
    // v2 §7.1 / §7.3: live-draft settings and locks.
    if (patch.draftMode !== undefined && patch.draftMode !== round.draftMode) {
      if (round.draftStartedAt) throw new HttpError(409, 'The draft has already started');
      if ((await repo.listPicks(round.id)).length > 0) {
        throw new HttpError(409, 'Undo all picks to change the draft mode');
      }
    }
    let pausedRemainingMs: null | undefined;
    if (patch.pickSeconds !== undefined && patch.pickSeconds !== round.pickSeconds) {
      if (round.draftStartedAt && !round.draftPausedAt) {
        throw new HttpError(409, 'Pause the draft to change the timer');
      }
      if (round.draftPausedAt) pausedRemainingMs = null; // resume gives the full new timer
    }
```

Inside `if (draftChanged) {`, as its first line:

```ts
      if (round.draftStartedAt) {
        throw new HttpError(409, 'The draft has started — the order and roster size are locked');
      }
```

and add the three fields to the `repo.updateRound(round.id, { … })` call:

```ts
      draftMode: patch.draftMode,
      pickSeconds: patch.pickSeconds,
      pausedRemainingMs,
```

- [ ] **Step 4: Create the start / pause / resume route**

Create `app/api/l/[slug]/admin/rounds/[id]/draft/[action]/route.ts`:

```ts
import { handle, HttpError, json, requireRound } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import type { DraftAction } from '@/lib/db/repo';
import { advance } from '@/lib/draft/advance';
import { draftPhase } from '@/lib/draft/live';
import { loadDraftState } from '@/lib/draft/state';
import { ring } from '@/lib/realtime/doorbell';
import { loadPool } from '@/lib/rounds/pool';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string; action: string }> };

const ACTIONS: readonly DraftAction[] = ['start', 'pause', 'resume'];

/** Spec §7.3: POST …/admin/rounds/{id}/draft/start | pause | resume (commissioner only). */
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id, action } = await ctx.params;
    const { league, player } = await requireLeagueRole(slug, 'commissioner');
    const round = await requireRound(league, id);
    if (!ACTIONS.includes(action as DraftAction)) throw new HttpError(404, 'Not found');
    const repo = getRepo();
    const now = new Date();
    const picks = await repo.listPicks(round.id);
    const phase = draftPhase(round, picks.length);

    if (action === 'start') {
      if (round.draftMode !== 'live') throw new HttpError(409, 'Switch this round to live draft first');
      if (round.draftStartedAt) throw new HttpError(409, 'The draft has already started');
      const P = round.draftOrder.length;
      if (P === 0) throw new HttpError(409, 'Set the draft order before drafting');
      const pool = await loadPool(round, now);
      if (pool.stale && pool.tbaCount === 0) {
        throw new HttpError(503, "Couldn't reach The Blue Alliance for the team list. Try again in a minute.");
      }
      const T = pool.teams.length;
      if (P * round.rosterSize > T) {
        throw new HttpError(409, `With ${P} players and ${T} teams, roster size can be at most ${Math.floor(T / P)}`);
      }
    }
    if (action === 'pause' && phase !== 'live') throw new HttpError(409, "The draft isn't running");
    if (action === 'resume' && phase !== 'paused') throw new HttpError(409, "The draft isn't paused");

    if (!(await repo.draftControl(round.id, action as DraftAction))) {
      throw new HttpError(409, 'Draft changed in another tab — refresh');
    }
    if (action !== 'pause') await advance(round.id, now);
    await ring(round.id);
    const fresh = (await repo.getRound(round.id))!;
    return json(await loadDraftState(fresh, player, new Date()));
  });
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/api/draftAdmin.test.ts tests/api/rounds.test.ts tests/config/dynamic-exports.test.ts`
Expected: PASS (the v1 rounds tests still pass: commissioner-mode rounds never set `draftStartedAt`).

- [ ] **Step 6: Commit**

```bash
git add "app/api/l/[slug]/admin/rounds/[id]/route.ts" "app/api/l/[slug]/admin/rounds/[id]/draft/[action]/route.ts" tests/api/draftAdmin.test.ts
git commit -m "feat(draft): commissioner draft mode, timer, start, pause, resume"
```

---

### Task 11: Commissioner picks and undo in live mode go through the atomic functions

**Files:**
- Modify: `app/api/l/[slug]/admin/rounds/[id]/picks/route.ts` (POST)
- Modify: `app/api/l/[slug]/admin/rounds/[id]/picks/[pickNumber]/route.ts` (DELETE, PATCH)
- Test: `tests/api/draftCommissioner.test.ts` (new)

**Interfaces:**
- Consumes: `draftPhase` (Task 2); `makePickAtomic`, `undoPickAtomic`, `setAutodraft` (Task 3); `draftError`, `classifyFailedPick`, `ring` (Task 4); `advance` (Task 6).
- Produces: in **live** mode, v1's "Pick for {name}" (`POST …/admin/rounds/{id}/picks`, always the current snake picker) uses `draft_make_pick` and returns the same 409 codes as Task 8; undo (`DELETE …/picks/{n}`) uses `draft_undo_pick`, restarts the deadline, and switches auto-draft off for the player of an undone auto-pick; replacing a pick (`PATCH …/picks/{n}`) rings. **Commissioner-mode behavior is unchanged.**

- [ ] **Step 1: Write the failing tests**

Create `tests/api/draftCommissioner.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks, resetDraftMocks } from '../helpers/draftMocks';

vi.mock('@/lib/db', async () => (await import('../helpers/draftMocks')).dbModule);
vi.mock('@/lib/tba/client', async () => (await import('../helpers/draftMocks')).tbaModule);
vi.mock('@/lib/auth/session', async () => (await import('../helpers/draftMocks')).sessionModule);
vi.mock('@/lib/realtime/doorbell', async () => (await import('../helpers/draftMocks')).doorbellModule);

import { DELETE as undoRoute, PATCH as replaceRoute } from '@/app/api/l/[slug]/admin/rounds/[id]/picks/[pickNumber]/route';
import { POST as adminPick } from '@/app/api/l/[slug]/admin/rounds/[id]/picks/route';
import { params, readJson, request } from '../helpers/api';
import { seedLiveDraft, T0 } from '../helpers/draft';
import { createMemoryRepo } from '../helpers/memoryRepo';

const clock = { now: T0 };
beforeEach(() => {
  clock.now = T0;
  resetDraftMocks(createMemoryRepo({ now: () => clock.now }));
});
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

type Seeded = Awaited<ReturnType<typeof seedLiveDraft>>;
const pickFor = (s: Seeded, expectedPickNumber: number, teamKey: string) =>
  adminPick(request('POST', '/x', { body: { expectedPickNumber, teamKey } }), params({ slug: s.league.slug, id: s.round.id }));
const undo = (s: Seeded, n: number) =>
  undoRoute(request('DELETE', '/x'), params({ slug: s.league.slug, id: s.round.id, pickNumber: String(n) }));
const replace = (s: Seeded, n: number, teamKey: string) =>
  replaceRoute(request('PATCH', '/x', { body: { teamKey } }), params({ slug: s.league.slug, id: s.round.id, pickNumber: String(n) }));

describe('commissioner picks in a live draft', () => {
  it('"Pick for Mom" saves Mom\'s pick through the atomic function and rings', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    expect((await pickFor(s, 0, 'frc1')).status).toBe(201); // Joey's own
    const res = await pickFor(s, 1, 'frc2');
    expect(res.status).toBe(201);
    expect((await readJson(res)).pick).toEqual({ pickNumber: 1, playerId: s.mom.id, teamKey: 'frc2' });
    expect(mocks.ring).toHaveBeenCalledTimes(2);
  });

  it('uses the live-draft 409 codes', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    await pickFor(s, 0, 'frc1');
    expect((await readJson(await pickFor(s, 1, 'frc1'))).code).toBe('taken');
    expect((await readJson(await pickFor(s, 0, 'frc3'))).code).toBe('stale');
    await mocks.repo.draftControl(s.round.id, 'pause');
    expect((await readJson(await pickFor(s, 1, 'frc3'))).code).toBe('not_live');
  });
});

describe('commissioner undo in a live draft', () => {
  it('undoing an auto-pick removes it for good: auto-draft goes off, the deadline restarts (Review Focus 5)', async () => {
    const s = await seedLiveDraft(mocks.repo, { pickSeconds: 60 });
    await mocks.repo.setAutodraft(s.round.id, s.joey.id, true);
    await mocks.repo.draftControl(s.round.id, 'start');
    // Simulate the start route's advance: Joey (auto) picks frc1.
    await mocks.repo.makePickAtomic({ roundId: s.round.id, pickNumber: 0, playerId: s.joey.id, teamKey: 'frc1', requireDue: false, auto: true });
    mocks.user = s.joeyUser;
    clock.now = later(20);
    const res = await undo(s, 0);
    expect(res.status).toBe(204);
    expect(await mocks.repo.listPicks(s.round.id)).toEqual([]);
    expect(await mocks.repo.getAutodraft(s.round.id, s.joey.id)).toBe(false);
    expect((await mocks.repo.getRound(s.round.id))!.pickDeadline).toBe(later(80).toISOString());
    expect(mocks.ring).toHaveBeenCalledTimes(1);
  });

  it('undoing a hand pick leaves auto-draft alone (so an auto-drafter is picked for again)', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    await pickFor(s, 0, 'frc5'); // by hand
    await mocks.repo.setAutodraft(s.round.id, s.joey.id, true); // Joey turns auto-draft on afterwards
    expect((await undo(s, 0)).status).toBe(204);
    expect(await mocks.repo.getAutodraft(s.round.id, s.joey.id)).toBe(true);
    // Joey is back on the clock with auto-draft on, so advance picks for him (lowest number).
    expect((await mocks.repo.listPicks(s.round.id)).map((p) => [p.teamKey, p.auto])).toEqual([['frc1', true]]);
  });

  it('only the last pick', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    await pickFor(s, 0, 'frc1');
    await pickFor(s, 1, 'frc2');
    expect((await undo(s, 0)).status).toBe(409);
  });

  it('replacing a pick in a live draft rings', async () => {
    const s = await seedLiveDraft(mocks.repo, { start: true });
    mocks.user = s.joeyUser;
    await pickFor(s, 0, 'frc1');
    mocks.ring.mockClear();
    expect((await replace(s, 0, 'frc4')).status).toBe(200);
    expect(mocks.ring).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/api/draftCommissioner.test.ts`
Expected: FAIL — the live picks go through v1 `insertPick` (no `auto` routing, no ring), and undo doesn't touch auto-draft.

- [ ] **Step 3: Route live-mode picks through `draft_make_pick`**

Replace `app/api/l/[slug]/admin/rounds/[id]/picks/route.ts` with (the commissioner-mode branch is v1's code unchanged):

```ts
import { z } from 'zod';
import { handle, HttpError, json, parseBody, requireRound } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { advance } from '@/lib/draft/advance';
import { classifyFailedPick, draftError } from '@/lib/draft/errors';
import { draftPhase } from '@/lib/draft/live';
import { ring } from '@/lib/realtime/doorbell';
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
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const round = await requireRound(league, id);
    const { expectedPickNumber, teamKey } = await parseBody(req, bodySchema);
    const repo = getRepo();
    const now = new Date();

    if (round.draftOrder.length === 0) {
      throw new HttpError(409, 'Set the draft order before drafting');
    }
    const picks = await repo.listPicks(round.id);
    const live = round.draftMode === 'live';
    if (live && draftPhase(round, picks.length) !== 'live') throw draftError('not_live');
    if (expectedPickNumber !== picks.length) {
      throw live ? draftError('stale') : new HttpError(409, 'Draft changed in another tab — refresh');
    }
    if (picks.length >= round.draftOrder.length * round.rosterSize) {
      throw new HttpError(409, 'The draft is full');
    }
    const pool = await loadPool(round, now);
    if (!pool.teams.some((t) => t.teamKey === teamKey)) {
      throw new HttpError(400, "That team isn't in this event's team pool");
    }
    const playerId = pickerFor(expectedPickNumber, round.draftOrder);

    if (live) {
      // v2 §7.3 "Pick for Mom": same atomic path as a player's own pick.
      if (picks.some((p) => p.teamKey === teamKey)) throw draftError('taken');
      const ok = await repo.makePickAtomic({
        roundId: round.id, pickNumber: expectedPickNumber, playerId, teamKey, requireDue: false, auto: false,
      });
      if (!ok) throw await classifyFailedPick(round.id, teamKey);
      await advance(round.id, now);
      await ring(round.id);
      return json({ pick: { pickNumber: expectedPickNumber, playerId, teamKey } }, 201);
    }

    // The database's unique constraints are the real guard against two tabs picking at once.
    // If one fires, handle() turns it into the matching 409.
    const saved = await repo.insertPick({ roundId: round.id, pickNumber: expectedPickNumber, playerId, teamKey });
    return json(
      { pick: { pickNumber: saved.pickNumber, playerId: saved.playerId, teamKey: saved.teamKey } },
      201,
    );
  });
}
```

- [ ] **Step 4: Route live-mode undo through `draft_undo_pick`; ring on replace**

In `app/api/l/[slug]/admin/rounds/[id]/picks/[pickNumber]/route.ts` add imports:

```ts
import { advance } from '@/lib/draft/advance';
import { ring } from '@/lib/realtime/doorbell';
```

Replace the body of `DELETE` after the existing `if (n === null || picks.length === 0 || n !== picks.length - 1) { … }` check with:

```ts
    if (round.draftMode === 'live' && round.draftStartedAt) {
      const undone = picks[picks.length - 1];
      if (!(await repo.undoPickAtomic(round.id, n))) {
        throw new HttpError(409, 'Only the last pick can be undone — refresh');
      }
      // v2 §7.3: otherwise advance() would re-pick the same team and the undo would do nothing.
      if (undone.auto) await repo.setAutodraft(round.id, undone.playerId, false);
      await advance(round.id, new Date());
      await ring(round.id);
      return noContent();
    }
    await repo.deletePick(round.id, n);
    return noContent();
```

In `PATCH`, just before `return json({ pick: … })`, add:

```ts
    if (round.draftMode === 'live' && saved !== existing) await ring(round.id);
```

- [ ] **Step 5: Run the tests (new + v1 picks)**

Run: `npx vitest run tests/api/draftCommissioner.test.ts tests/api/picks.test.ts`
Expected: PASS — the v1 picks tests (commissioner mode) are unchanged.

- [ ] **Step 6: Commit**

```bash
git add "app/api/l/[slug]/admin/rounds/[id]/picks/route.ts" "app/api/l/[slug]/admin/rounds/[id]/picks/[pickNumber]/route.ts" tests/api/draftCommissioner.test.ts
git commit -m "feat(draft): commissioner pick-for and undo use the atomic functions in live drafts"
```

---

### Task 12: Browser-side draft helpers — refetch rate limit, tick timing, pool filtering, API wrapper

**Files:**
- Create: `lib/draft/client.ts`, `lib/draft/poolView.ts`, `lib/draft/api.ts`
- Test: `tests/draft/client.test.ts`, `tests/draft/poolView.test.ts`, `tests/draft/api.test.ts` (new)

**Interfaces:**
- Consumes: `DraftState` (Task 7, type-only), `PoolEntry` (Task 5, type-only), `DraftAction` (Task 3, type-only).
- Produces (all browser-safe; no `node:`, no `lib/db` runtime imports):
  - `createRefetcher(deps: RefetcherDeps): Refetcher` with `ring()`, `refetchNow()`, `stop()`; defaults `DEBOUNCE_MS = 250`, `MIN_GAP_MS = 1500`
  - `pollIntervalMs(subscribed: boolean): number` (15 000 / 3 000)
  - `shouldTick(i: TickInput): boolean` (deadline + 500 ms, retry every 2 s); `TICK_GRACE_MS = 500`, `TICK_RETRY_MS = 2000`
  - `formatClock(ms: number): string` ("0:42"); `URGENT_MS = 10_000`
  - `titleFrame(base: string, flashing: boolean, frame: number): string` ("Your pick!")
  - `type PoolSort = 'proj' | 'opr' | 'number'`; `filterSortPool(entries, { query, sort, availableOnly, taken }): PoolEntry[]`
  - `draftApi(slug, roundId)` → `{ state, pool, pick, tick, setQueue, setAutodraft, pickFor, undo, control }`; `class DraftApiError { status; code?: string }`

- [ ] **Step 1: Write the failing tests**

Create `tests/draft/client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createRefetcher, formatClock, pollIntervalMs, shouldTick, titleFrame } from '@/lib/draft/client';

/** Manual timers + clock, so the test decides when time passes. */
function fakeTime() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id: unknown) => void timers.delete(id as number),
    /** Lets settled promises run (fetch finishing, follow-up rings), then fires due timers in order. */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        for (let i = 0; i < 5; i++) await Promise.resolve();
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
  };
}

describe('createRefetcher (§7.5)', () => {
  it('debounces a burst of rings into one fetch after 250 ms', async () => {
    const t = fakeTime();
    const fetch = vi.fn(async () => {});
    const r = createRefetcher({ fetch, ...t });
    for (let i = 0; i < 5; i++) r.ring();
    await t.advance(249);
    expect(fetch).not.toHaveBeenCalled();
    await t.advance(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never fetches more than once per 1.5 s, however fast the rings come (doorbell spam)', async () => {
    const t = fakeTime();
    const fetch = vi.fn(async () => {});
    const r = createRefetcher({ fetch, ...t });
    for (let ms = 0; ms < 6000; ms += 50) {
      r.ring();
      await t.advance(50);
    }
    // 6 s of spam: first fetch at 250 ms, then every 1.5 s → at most 4 fetches.
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(4);
    expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('a ring while a fetch is in flight schedules exactly one follow-up', async () => {
    const t = fakeTime();
    let release: () => void = () => {};
    const fetch = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const r = createRefetcher({ fetch, ...t });
    r.ring();
    await t.advance(250);
    expect(fetch).toHaveBeenCalledTimes(1);
    r.ring();
    r.ring();
    release();
    await t.advance(1500);
    expect(fetch).toHaveBeenCalledTimes(2);
    release();
    await t.advance(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refetchNow skips the debounce; stop cancels a pending fetch', async () => {
    const t = fakeTime();
    const fetch = vi.fn(async () => {});
    const r = createRefetcher({ fetch, ...t });
    r.refetchNow();
    await t.advance(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    r.ring();
    r.stop();
    await t.advance(5000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('timing helpers', () => {
  it('polls every 3 s without Realtime and every 15 s with it', () => {
    expect(pollIntervalMs(false)).toBe(3000);
    expect(pollIntervalMs(true)).toBe(15000);
  });

  it('ticks only for members, after deadline + 500 ms, and at most every 2 s', () => {
    const deadline = new Date(100_000).toISOString();
    const base = { phase: 'live' as const, deadline, isMember: true, offsetMs: 0, lastTickAtMs: null };
    expect(shouldTick({ ...base, localNowMs: 100_499 })).toBe(false);
    expect(shouldTick({ ...base, localNowMs: 100_500 })).toBe(true);
    expect(shouldTick({ ...base, localNowMs: 101_000, lastTickAtMs: 100_500 })).toBe(false);
    expect(shouldTick({ ...base, localNowMs: 102_500, lastTickAtMs: 100_500 })).toBe(true);
    expect(shouldTick({ ...base, localNowMs: 200_000, isMember: false })).toBe(false);
    expect(shouldTick({ ...base, localNowMs: 200_000, phase: 'paused' })).toBe(false);
    expect(shouldTick({ ...base, localNowMs: 200_000, deadline: null })).toBe(false);
    // Phone clock 60 s slow: the server offset makes it tick on time anyway.
    expect(shouldTick({ ...base, localNowMs: 40_500, offsetMs: 60_000 })).toBe(true);
  });

  it('formats the clock and flashes the title', () => {
    expect(formatClock(42_000)).toBe('0:42');
    expect(formatClock(41_001)).toBe('0:42');
    expect(formatClock(120_000)).toBe('2:00');
    expect(formatClock(0)).toBe('0:00');
    expect(titleFrame('Ramp Riot draft', true, 0)).toBe('Your pick!');
    expect(titleFrame('Ramp Riot draft', true, 1)).toBe('Ramp Riot draft');
    expect(titleFrame('Ramp Riot draft', false, 0)).toBe('Ramp Riot draft');
  });
});
```

Create `tests/draft/poolView.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { filterSortPool } from '@/lib/draft/poolView';
import type { PoolEntry } from '@/lib/pool/entries';

const e = (teamKey: string, nickname: string, proj: number | null, opr: number | null = null): PoolEntry => ({
  teamKey, nickname, proj, opr, record: null, bestFinish: null, rank: null, available: true,
});
const pool = [e('frc341', 'Miss Daisy', 38.2, 40), e('frc5181', 'Explorer Robotics', null, 12), e('frc25', 'Raider Robotix', 41, null), e('frc3419', 'RoHAWKtics', 20, 55)];
const keys = (list: PoolEntry[]) => list.map((x) => x.teamKey);
const opts = { query: '', sort: 'proj' as const, availableOnly: true, taken: new Set<string>() };

describe('filterSortPool (§6.3)', () => {
  it('sorts by projection with New teams last', () => {
    expect(keys(filterSortPool(pool, opts))).toEqual(['frc25', 'frc341', 'frc3419', 'frc5181']);
  });
  it('sorts by OPR (missing last) and by team number', () => {
    expect(keys(filterSortPool(pool, { ...opts, sort: 'opr' }))).toEqual(['frc3419', 'frc341', 'frc5181', 'frc25']);
    expect(keys(filterSortPool(pool, { ...opts, sort: 'number' }))).toEqual(['frc25', 'frc341', 'frc3419', 'frc5181']);
  });
  it('searches by number prefix or nickname, case-insensitively', () => {
    expect(keys(filterSortPool(pool, { ...opts, query: '341' }))).toEqual(['frc341', 'frc3419']);
    expect(keys(filterSortPool(pool, { ...opts, query: 'robotics' }))).toEqual(['frc5181']);
    expect(keys(filterSortPool(pool, { ...opts, query: ' ROBOT ' }))).toEqual(['frc25', 'frc5181']);
  });
  it('hides taken teams unless "Available only" is off', () => {
    const taken = new Set(['frc25']);
    expect(keys(filterSortPool(pool, { ...opts, taken }))).not.toContain('frc25');
    const all = filterSortPool(pool, { ...opts, taken, availableOnly: false });
    expect(all.find((x) => x.teamKey === 'frc25')?.available).toBe(false);
  });
});
```

Create `tests/draft/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftApiError, draftApi } from '@/lib/draft/api';

afterEach(() => vi.unstubAllGlobals());

describe('draftApi', () => {
  it('posts a pick to the player route with JSON', async () => {
    const fetchMock = vi.fn(async () => Response.json({ pick: {} }, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await draftApi('habich-fam', 'r1').pick(3, 'frc341');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/l/habich-fam/rounds/r1/draft/pick');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ expectedPickNumber: 3, teamKey: 'frc341' });
  });

  it('turns an error body into DraftApiError with its code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'That team was just taken', code: 'taken' }, { status: 409 })));
    const err = await draftApi('s', 'r').pick(0, 'frc1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DraftApiError);
    expect(err).toMatchObject({ status: 409, code: 'taken', message: 'That team was just taken' });
  });

  it('uses the admin routes for commissioner actions and handles 204', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await draftApi('s', 'r').undo(4);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/l/s/admin/rounds/r/picks/4');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/draft/client.test.ts tests/draft/poolView.test.ts tests/draft/api.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `lib/draft/client.ts`**

```ts
// Browser-side draft timing (spec §7.4–§7.6). Pure or dependency-injected, so it's testable in Node.
import type { DraftPhase } from '@/lib/draft/live';

export const DEBOUNCE_MS = 250;
export const MIN_GAP_MS = 1500;
export const TICK_GRACE_MS = 500;
export const TICK_RETRY_MS = 2000;
export const URGENT_MS = 10_000;

export type RefetcherDeps = {
  fetch: () => Promise<unknown>;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  debounceMs?: number;
  minGapMs?: number;
};
export type Refetcher = { ring: () => void; refetchNow: () => void; stop: () => void };

/**
 * Turns doorbell rings (and polls) into state fetches: debounced 250 ms, at most one per 1.5 s, and a ring
 * during an in-flight fetch schedules exactly one follow-up. Anyone can ring a public channel, so this
 * cap is what keeps a prankster from making every phone hammer the server (§7.5).
 */
export function createRefetcher(deps: RefetcherDeps): Refetcher {
  const debounce = deps.debounceMs ?? DEBOUNCE_MS;
  const minGap = deps.minGapMs ?? MIN_GAP_MS;
  let timer: unknown = null;
  let inFlight = false;
  let followUp = false;
  let lastStart = Number.NEGATIVE_INFINITY;
  let stopped = false;

  async function fire() {
    timer = null;
    inFlight = true;
    lastStart = deps.now();
    try {
      await deps.fetch();
    } catch {
      // The next ring or poll tries again.
    } finally {
      inFlight = false;
    }
    if (followUp && !stopped) {
      followUp = false;
      ring();
    }
  }

  function ring() {
    if (stopped) return;
    if (inFlight) {
      followUp = true;
      return;
    }
    if (timer !== null) return;
    const wait = Math.max(debounce, lastStart + minGap - deps.now());
    timer = deps.setTimeout(() => void fire(), wait);
  }

  function refetchNow() {
    if (stopped) return;
    if (inFlight) {
      followUp = true;
      return;
    }
    if (timer !== null) deps.clearTimeout(timer);
    timer = deps.setTimeout(() => void fire(), 0);
  }

  return {
    ring,
    refetchNow,
    stop() {
      stopped = true;
      if (timer !== null) deps.clearTimeout(timer);
      timer = null;
    },
  };
}

export function pollIntervalMs(subscribed: boolean): number {
  return subscribed ? 15_000 : 3_000;
}

export type TickInput = {
  phase: DraftPhase;
  deadline: string | null;
  isMember: boolean;
  offsetMs: number;
  localNowMs: number;
  lastTickAtMs: number | null;
};

/** §7.4: members' phones ask the server to auto-pick once deadline + 500 ms passes, retrying every 2 s. */
export function shouldTick(i: TickInput): boolean {
  if (!i.isMember || i.phase !== 'live' || !i.deadline) return false;
  if (i.localNowMs + i.offsetMs < Date.parse(i.deadline) + TICK_GRACE_MS) return false;
  return i.lastTickAtMs === null || i.localNowMs - i.lastTickAtMs >= TICK_RETRY_MS;
}

/** "0:42". Rounds up, so the clock shows 0:01 until time is really up. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** §7.6: the tab title alternates with "Your pick!" once a second while it's your turn. */
export function titleFrame(base: string, flashing: boolean, frame: number): string {
  return flashing && frame % 2 === 0 ? 'Your pick!' : base;
}
```

- [ ] **Step 4: Implement `lib/draft/poolView.ts`**

```ts
import type { PoolEntry } from '@/lib/pool/entries';

export type PoolSort = 'proj' | 'opr' | 'number';

function numberParts(teamKey: string): [number, string] {
  const m = /^frc([0-9]+)([A-Z]?)$/.exec(teamKey);
  return m ? [Number(m[1]), m[2]] : [Number.MAX_SAFE_INTEGER, teamKey];
}
const byNumber = (a: PoolEntry, b: PoolEntry) => {
  const [an, as] = numberParts(a.teamKey);
  const [bn, bs] = numberParts(b.teamKey);
  return an - bn || as.localeCompare(bs);
};
/** Higher first; missing values last; then team number. */
const byStat = (pick: (e: PoolEntry) => number | null) => (a: PoolEntry, b: PoolEntry) => {
  const x = pick(a);
  const y = pick(b);
  if (x !== null && y !== null && x !== y) return y - x;
  if ((x === null) !== (y === null)) return x === null ? 1 : -1;
  return byNumber(a, b);
};

/**
 * Spec §6.3: search by number prefix or nickname; sort by Proj (default, "New" last), OPR, or number;
 * "Available only" hides teams taken so far. `taken` comes from the live draft state, not the pool fetch,
 * so the list is right between pool reloads.
 */
export function filterSortPool(
  entries: PoolEntry[],
  opts: { query: string; sort: PoolSort; availableOnly: boolean; taken: Set<string> },
): PoolEntry[] {
  const q = opts.query.trim().toLowerCase();
  const rows = entries
    .map((e) => ({ ...e, available: !opts.taken.has(e.teamKey) }))
    .filter((e) => !opts.availableOnly || e.available)
    .filter(
      (e) => q === '' || e.teamKey.slice(3).toLowerCase().startsWith(q) || (e.nickname ?? '').toLowerCase().includes(q),
    );
  const compare = opts.sort === 'proj' ? byStat((e) => e.proj) : opts.sort === 'opr' ? byStat((e) => e.opr) : byNumber;
  return rows.sort(compare);
}
```

- [ ] **Step 5: Implement `lib/draft/api.ts`**

```ts
// Runs in the browser. Do not import anything from node:* or lib/db here (types only).
import type { DraftAction } from '@/lib/db/repo';
import type { DraftState } from '@/lib/draft/state';
import type { PoolEntry } from '@/lib/pool/entries';

export class DraftApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'DraftApiError';
  }
}

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new DraftApiError(res.status, data.error ?? 'Something went wrong', data.code);
  return data as T;
}

export type DraftApi = ReturnType<typeof draftApi>;

export function draftApi(slug: string, roundId: string) {
  const base = `/api/l/${slug}/rounds/${roundId}`;
  const admin = `/api/l/${slug}/admin/rounds/${roundId}`;
  return {
    state: () => call<DraftState>(`${base}/draft/state`),
    pool: () => call<PoolEntry[]>(`${base}/pool`),
    pick: (expectedPickNumber: number, teamKey: string) =>
      call<unknown>(`${base}/draft/pick`, 'POST', { expectedPickNumber, teamKey }),
    tick: (expectedPickNumber: number) => call<{ picked: boolean }>(`${base}/draft/tick`, 'POST', { expectedPickNumber }),
    setQueue: (teamKeys: string[]) => call<{ queue: string[] }>(`${base}/draft/queue`, 'PUT', { teamKeys }),
    setAutodraft: (on: boolean) => call<{ autodraft: boolean }>(`${base}/draft/autodraft`, 'PUT', { on }),
    pickFor: (expectedPickNumber: number, teamKey: string) =>
      call<unknown>(`${admin}/picks`, 'POST', { expectedPickNumber, teamKey }),
    undo: (pickNumber: number) => call<void>(`${admin}/picks/${pickNumber}`, 'DELETE'),
    control: (action: DraftAction) => call<DraftState>(`${admin}/draft/${action}`, 'POST'),
  };
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/draft/client.test.ts tests/draft/poolView.test.ts tests/draft/api.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/draft/client.ts lib/draft/poolView.ts lib/draft/api.ts tests/draft/client.test.ts tests/draft/poolView.test.ts tests/draft/api.test.ts
git commit -m "feat(draft): browser helpers for refetch limits, ticks, pool filtering, API calls"
```

---

### Task 13: Draft room building blocks — banner, pool list, queue, confirm sheet, rosters, board highlight

**Files:**
- Create: `components/draft/DraftRoomBanner.tsx`, `components/draft/PoolList.tsx`, `components/draft/QueueList.tsx`, `components/draft/ConfirmSheet.tsx`, `components/draft/DraftRosters.tsx`
- Modify: `components/DraftBoard.tsx` (optional `highlightPick`)
- Test: `tests/ui/draft-components.test.ts` (new)

**Interfaces:**
- Consumes: `DraftState` (Task 7), `PoolEntry` (Task 5), `picksUntilTurn` (Task 2), `formatClock`/`URGENT_MS` (Task 12), `filterSortPool`/`PoolSort` (Task 12), `moveItem` (v1 `lib/draft.ts`), `teamLabel` (v1), UI primitives (`Button`, `BumperPlate`, `Badge`, `Input`, `Select`, `Alert`, icons `Plus`/`Check`/`ArrowUp`/`ArrowDown`/`X`).
- Produces:
  - `bannerLines(state: DraftState, remainingMs: number | null, meId: string | null): { main: string; clock: string | null; sub: string | null; urgent: boolean }` and `<DraftRoomBanner state remainingMs meId reconnecting />`
  - `<PoolList entries taken queued canDraft draftLabel readOnly onDraft onToggleQueue />`
  - `<QueueList queue teamNames taken disabled onChange />`
  - `confirmText(entry: PoolEntry, forName: string | null): string` and `<ConfirmSheet entry forName busy onConfirm onCancel />`
  - `<DraftRosters order picks rosterSize teamNames />`
  - `<DraftBoard … highlightPick?: number />` (rings the newest pick)

- [ ] **Step 1: Write the failing tests**

Create `tests/ui/draft-components.test.ts`:

```ts
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConfirmSheet, confirmText } from '@/components/draft/ConfirmSheet';
import { bannerLines, DraftRoomBanner } from '@/components/draft/DraftRoomBanner';
import { DraftRosters } from '@/components/draft/DraftRosters';
import { PoolList } from '@/components/draft/PoolList';
import { QueueList } from '@/components/draft/QueueList';
import { DraftBoard } from '@/components/DraftBoard';
import type { DraftState } from '@/lib/draft/state';
import type { PoolEntry } from '@/lib/pool/entries';

const text = (html: string) =>
  html.replace(/<[^>]+>/g, '').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const state = (over: Partial<DraftState> = {}): DraftState => ({
  phase: 'live', draftMode: 'live', pickNumber: 1, totalPicks: 6,
  onClock: { playerId: 'mom', name: 'Mom' }, deadline: '2026-10-23T23:01:00.000Z', serverNow: '2026-10-23T23:00:18.000Z',
  pickSeconds: 60, pausedRemainingMs: null,
  order: [{ playerId: 'joey', name: 'Joey' }, { playerId: 'mom', name: 'Mom' }, { playerId: 'dad', name: 'Dad' }],
  rosterSize: 2, picks: [{ pickNumber: 0, playerId: 'joey', teamKey: 'frc341', auto: false }], autodraftPlayerIds: [],
  ...over,
});
const entry = (teamKey: string, proj: number | null, nickname = 'Team'): PoolEntry => ({
  teamKey, nickname, proj, record: null, bestFinish: null, opr: null, rank: null, available: true,
});

describe('bannerLines (§7.6)', () => {
  it('names who is on the clock with the countdown, and how far away my turn is', () => {
    expect(bannerLines(state(), 42_000, 'dad')).toEqual({
      main: 'On the clock: Mom', clock: '0:42', sub: "You're up in 1 pick", urgent: false,
    });
    expect(bannerLines(state(), 42_000, 'joey').sub).toBe("You're up in 4 picks");
    expect(bannerLines(state(), 9_000, 'mom')).toMatchObject({ sub: 'Your pick!', urgent: true });
    expect(bannerLines(state({ pickSeconds: null, deadline: null }), null, null)).toMatchObject({ clock: null, sub: null });
  });
  it('covers setup, paused, and done', () => {
    expect(bannerLines(state({ phase: 'setup', onClock: null }), null, 'mom').main).toBe(
      'Waiting for the commissioner to start the draft',
    );
    expect(bannerLines(state({ phase: 'paused', pausedRemainingMs: 30_000 }), null, 'mom')).toMatchObject({
      main: 'Paused by commissioner', clock: '0:30 left',
    });
    expect(bannerLines(state({ phase: 'done', onClock: null }), null, 'mom')).toMatchObject({ main: 'Draft complete', sub: null });
  });
  it('renders "On the clock: Mom · 0:42" and a Reconnecting line', () => {
    const html = renderToStaticMarkup(h(DraftRoomBanner, { state: state(), remainingMs: 42_000, meId: null, reconnecting: true }));
    expect(text(html)).toContain('On the clock: Mom · 0:42');
    expect(text(html)).toContain('Reconnecting…');
  });
});

describe('PoolList (§6.3)', () => {
  const entries = [entry('frc341', null, 'Miss Daisy'), entry('frc25', 12.5, 'Raider Robotix')];
  const props = {
    entries, taken: new Set<string>(), queued: new Set(['frc25']), canDraft: false, draftLabel: 'Draft',
    readOnly: false, onDraft: () => {}, onToggleQueue: () => {},
  };
  it('shows a New chip for teams without a projection and Proj otherwise', () => {
    const t = text(renderToStaticMarkup(h(PoolList, props)));
    expect(t).toContain('New');
    expect(t).toContain('Proj 12.5');
    expect(t).toContain('Proj. uses standard scoring');
  });
  it('disables Draft when it is not my turn, and hides buttons for read-only viewers', () => {
    const html = renderToStaticMarkup(h(PoolList, props));
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Draft<\/button>/);
    expect(html).toContain('aria-label="Remove 25 from queue"');
    const ro = renderToStaticMarkup(h(PoolList, { ...props, readOnly: true }));
    expect(ro).not.toContain('>Draft<');
  });
});

describe('QueueList', () => {
  it('lists queued teams in order, dropping taken ones', () => {
    const t = text(renderToStaticMarkup(h(QueueList, {
      queue: ['frc254', 'frc341', 'frc25'], teamNames: { frc25: 'Raider Robotix' }, taken: new Set(['frc341']),
      disabled: false, onChange: () => {},
    })));
    expect(t.indexOf('254')).toBeLessThan(t.indexOf('Raider Robotix'));
    expect(t).not.toContain('341');
  });
  it('explains itself when empty', () => {
    const t = text(renderToStaticMarkup(h(QueueList, { queue: [], teamNames: {}, taken: new Set<string>(), disabled: false, onChange: () => {} })));
    expect(t).toContain('Your queue is empty');
  });
});

describe('ConfirmSheet', () => {
  it('asks "Draft 341?" (with Proj when known) or "Pick 341 for Mom?"', () => {
    expect(confirmText(entry('frc341', null), null)).toBe('Draft 341?');
    expect(confirmText(entry('frc341', 38.2), null)).toBe('Draft 341 · Proj 38.2?');
    expect(confirmText(entry('frc341', null), 'Mom')).toBe('Pick 341 for Mom?');
    const html = renderToStaticMarkup(h(ConfirmSheet, { entry: entry('frc341', null), forName: null, busy: false, onConfirm: () => {}, onCancel: () => {} }));
    expect(html).toContain('role="dialog"');
    expect(text(html)).toContain('Draft 341?');
  });
});

describe('DraftRosters and DraftBoard highlight', () => {
  it('lists each player with their teams', () => {
    const t = text(renderToStaticMarkup(h(DraftRosters, {
      order: state().order, picks: [{ pickNumber: 0, playerId: 'joey', teamKey: 'frc341', auto: true }], rosterSize: 2, teamNames: {},
    })));
    expect(t).toContain('Joey');
    expect(t).toContain('341');
    expect(t).toContain('auto');
    expect(t).toContain('Mom');
  });
  it('rings the newest pick on the board', () => {
    const html = renderToStaticMarkup(h(DraftBoard, {
      picks: [{ pickNumber: 0, playerId: 'joey', teamKey: 'frc341' }], draftOrder: ['joey', 'mom'], rosterSize: 1,
      playerNames: { joey: 'Joey', mom: 'Mom' }, teamNames: {}, highlightPick: 0,
    }));
    expect(html).toContain('data-newest="true"');
  });
});
```

(Order Joey, Mom, Dad with 2 rounds: picks 0–5 are Joey, Mom, Dad, Dad, Mom, Joey. At pick 1, Dad is 1 pick away and Joey 4.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ui/draft-components.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `components/draft/DraftRoomBanner.tsx`**

```tsx
import { Alert } from '@/components/ui/Alert';
import { formatClock, URGENT_MS } from '@/lib/draft/client';
import { picksUntilTurn } from '@/lib/draft/live';
import type { DraftState } from '@/lib/draft/state';

export type BannerLines = { main: string; clock: string | null; sub: string | null; urgent: boolean };

/** Spec §7.6 banner copy, as data so it's testable without a browser. */
export function bannerLines(state: DraftState, remainingMs: number | null, meId: string | null): BannerLines {
  const size = { rosterSize: state.rosterSize, draftOrder: state.order.map((o) => o.playerId) };
  const until = meId && state.phase !== 'done' ? picksUntilTurn(size, state.pickNumber, meId) : null;
  const sub = until === null ? null : until === 0 ? 'Your pick!' : `You're up in ${until} pick${until === 1 ? '' : 's'}`;
  switch (state.phase) {
    case 'setup':
      return { main: 'Waiting for the commissioner to start the draft', clock: null, sub: null, urgent: false };
    case 'paused':
      return {
        main: 'Paused by commissioner',
        clock: state.pausedRemainingMs === null ? null : `${formatClock(state.pausedRemainingMs)} left`,
        sub,
        urgent: false,
      };
    case 'done':
      return { main: 'Draft complete', clock: null, sub: null, urgent: false };
    default:
      return {
        main: `On the clock: ${state.onClock?.name ?? 'Unknown'}`,
        clock: remainingMs === null ? null : formatClock(remainingMs),
        sub,
        urgent: remainingMs !== null && remainingMs < URGENT_MS,
      };
  }
}

export function DraftRoomBanner({
  state,
  remainingMs,
  meId,
  reconnecting,
}: {
  state: DraftState;
  remainingMs: number | null;
  meId: string | null;
  reconnecting: boolean;
}) {
  const b = bannerLines(state, remainingMs, meId);
  const mine = b.sub === 'Your pick!';
  return (
    <div className="sticky top-0 z-20 -mx-4 space-y-2 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur">
      {reconnecting ? <Alert tone="warning">Reconnecting…</Alert> : null}
      {/* The ticking clock stays out of the live region so screen readers aren't read every second. */}
      <p className="sr-only" aria-live="polite">
        {b.main}
        {b.sub ? `. ${b.sub}` : ''}
      </p>
      <p aria-hidden="true" className="font-display text-[22px] font-bold leading-[26px] text-fg">
        {b.main}
        {b.clock ? (
          <>
            {' · '}
            <span className={b.urgent ? 'text-red-alliance-text' : undefined}>{b.clock}</span>
          </>
        ) : null}
      </p>
      {b.sub ? (
        <p aria-hidden="true" className={`text-[15px] font-semibold ${mine ? 'text-accent' : 'text-primary'}`}>
          {b.sub}
        </p>
      ) : null}
    </div>
  );
}
```

(The test's `text()` joins the sr-only line and the visible line; both contain the expected strings.)

- [ ] **Step 4: Create `components/draft/PoolList.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { BumperPlate } from '@/components/ui/BumperPlate';
import { Button } from '@/components/ui/Button';
import { Check, Plus } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { filterSortPool, type PoolSort } from '@/lib/draft/poolView';
import type { PoolEntry } from '@/lib/pool/entries';
import { teamLabel } from '@/lib/teams';

/** Season pools can have thousands of teams; search narrows them. */
const SHOW_AT_MOST = 100;

const FINISH: Record<NonNullable<PoolEntry['bestFinish']>, string> = {
  winner: 'Winner',
  finalist: 'Finalist',
  captain: 'Captain',
  picked: 'Picked',
};

function statsLine(e: PoolEntry): string {
  const parts: string[] = [];
  if (e.record) parts.push(e.record.join('-'));
  if (e.bestFinish) parts.push(FINISH[e.bestFinish]);
  if (e.opr !== null) parts.push(`OPR ${e.opr.toFixed(1)}`);
  if (e.rank !== null) parts.push(`Rank ${e.rank}`);
  return parts.length > 0 ? parts.join(' · ') : 'No stats yet';
}

export function PoolList({
  entries,
  taken,
  queued,
  canDraft,
  draftLabel,
  readOnly,
  onDraft,
  onToggleQueue,
}: {
  entries: PoolEntry[];
  taken: Set<string>;
  queued: Set<string>;
  canDraft: boolean;
  draftLabel: string;
  readOnly: boolean;
  onDraft: (entry: PoolEntry) => void;
  onToggleQueue: (teamKey: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<PoolSort>('proj');
  const [availableOnly, setAvailableOnly] = useState(true);
  const rows = filterSortPool(entries, { query, sort, availableOnly, taken });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Input
          label="Search teams"
          inputMode="search"
          placeholder="Number or name"
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
        />
        <Select label="Sort" value={sort} onChange={(ev) => setSort(ev.target.value as PoolSort)}>
          <option value="proj">Proj</option>
          <option value="opr">OPR</option>
          <option value="number">Number</option>
        </Select>
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[15px] text-fg">
        <input
          type="checkbox"
          className="size-5"
          checked={availableOnly}
          onChange={(ev) => setAvailableOnly(ev.target.checked)}
        />
        Available only
      </label>

      {rows.length === 0 ? <p className="text-sm text-fg-muted">No teams match.</p> : null}
      <ul className="space-y-2">
        {rows.slice(0, SHOW_AT_MOST).map((e) => {
          const label = teamLabel(e.teamKey);
          const isQueued = queued.has(e.teamKey);
          return (
            <li
              key={e.teamKey}
              className={`flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2 ${e.available ? '' : 'opacity-50'}`}
            >
              <BumperPlate number={label} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-fg">{e.nickname ?? `Team ${label}`}</p>
                <p className="truncate text-[13px] leading-[18px] text-fg-muted">{statsLine(e)}</p>
              </div>
              {e.proj === null ? (
                <Badge tone="neutral">New</Badge>
              ) : (
                <span className="shrink-0 font-display text-[17px] font-bold text-fg">Proj {e.proj.toFixed(1)}</span>
              )}
              {readOnly ? null : (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={isQueued ? `Remove ${label} from queue` : `Add ${label} to queue`}
                    aria-pressed={isQueued}
                    onClick={() => onToggleQueue(e.teamKey)}
                  >
                    {isQueued ? <Check className="size-5" /> : <Plus className="size-5" />}
                  </Button>
                  <Button size="sm" disabled={!canDraft || !e.available} onClick={() => onDraft(e)}>
                    {draftLabel}
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {rows.length > SHOW_AT_MOST ? (
        <p className="text-sm text-fg-muted">
          Showing {SHOW_AT_MOST} of {rows.length}. Search to find more.
        </p>
      ) : null}
      <p className="text-[13px] text-fg-muted">Proj. uses standard scoring.</p>
    </div>
  );
}
```

(At 360 px a row is plate 56 + gap + text (flex-1, truncates) + chip ~44 + icon 44 + button ~64: it fits without sideways scroll because the name column shrinks. Check it in Task 14 Step 6.)

- [ ] **Step 5: Create `components/draft/QueueList.tsx`**

```tsx
'use client';

import { BumperPlate } from '@/components/ui/BumperPlate';
import { Button } from '@/components/ui/Button';
import { ArrowDown, ArrowUp, X } from '@/components/ui/icons';
import { moveItem } from '@/lib/draft';
import { teamLabel } from '@/lib/teams';

/** My draft queue (§7.6). Taken teams disappear; reordering saves the visible list. */
export function QueueList({
  queue,
  teamNames,
  taken,
  disabled,
  onChange,
}: {
  queue: string[];
  teamNames: Record<string, string>;
  taken: Set<string>;
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const visible = queue.filter((k) => !taken.has(k));
  if (visible.length === 0) {
    return (
      <p className="text-[15px] text-fg-muted">
        Your queue is empty. Add teams from the Pool tab with +. When time runs out or you&apos;re on auto-draft, the
        first available team in your queue is picked for you.
      </p>
    );
  }
  return (
    <ol className="space-y-2">
      {visible.map((teamKey, i) => {
        const label = teamLabel(teamKey);
        return (
          <li key={teamKey} className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
            <span className="w-6 text-right text-[13px] text-fg-muted">{i + 1}</span>
            <BumperPlate number={label} size="sm" />
            <span className="min-w-0 flex-1 truncate text-[15px] text-fg">{teamNames[teamKey] ?? `Team ${label}`}</span>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Move ${label} up`}
              disabled={disabled || i === 0}
              onClick={() => onChange(moveItem(visible, i, -1))}
            >
              <ArrowUp className="size-5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Move ${label} down`}
              disabled={disabled || i === visible.length - 1}
              onClick={() => onChange(moveItem(visible, i, 1))}
            >
              <ArrowDown className="size-5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Remove ${label}`}
              disabled={disabled}
              onClick={() => onChange(visible.filter((k) => k !== teamKey))}
            >
              <X className="size-5" />
            </Button>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 6: Create `components/draft/ConfirmSheet.tsx`**

```tsx
'use client';

import { Button } from '@/components/ui/Button';
import type { PoolEntry } from '@/lib/pool/entries';
import { teamLabel } from '@/lib/teams';

/** §7.6: "Draft 341 · Proj 38.2?" — or, for a commissioner picking for someone, "Pick 341 for Mom?". */
export function confirmText(entry: PoolEntry, forName: string | null): string {
  const label = teamLabel(entry.teamKey);
  if (forName) return `Pick ${label} for ${forName}?`;
  return entry.proj === null ? `Draft ${label}?` : `Draft ${label} · Proj ${entry.proj.toFixed(1)}?`;
}

export function ConfirmSheet({
  entry,
  forName,
  busy,
  onConfirm,
  onCancel,
}: {
  entry: PoolEntry;
  forName: string | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-pick-title"
        className="w-full space-y-4 rounded-t-card bg-surface px-4 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <p id="confirm-pick-title" className="font-display text-[22px] font-bold leading-[26px] text-fg">
          {confirmText(entry, forName)}
        </p>
        {entry.nickname ? <p className="text-[15px] text-fg-muted">{entry.nickname}</p> : null}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} busy={busy} autoFocus>
            {forName ? 'Pick' : 'Draft'}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Create `components/draft/DraftRosters.tsx`**

```tsx
import { BumperPlate } from '@/components/ui/BumperPlate';
import type { DraftState } from '@/lib/draft/state';
import { teamLabel } from '@/lib/teams';

export function DraftRosters({
  order,
  picks,
  rosterSize,
  teamNames,
}: {
  order: DraftState['order'];
  picks: DraftState['picks'];
  rosterSize: number;
  teamNames: Record<string, string>;
}) {
  return (
    <ul className="space-y-3">
      {order.map((p) => {
        const mine = picks.filter((pk) => pk.playerId === p.playerId);
        return (
          <li key={p.playerId} className="rounded-xl border border-border bg-surface px-3 py-3">
            <p className="mb-2 text-[15px] font-semibold text-fg">
              {p.name}{' '}
              <span className="font-normal text-fg-muted">
                · {mine.length} of {rosterSize}
              </span>
            </p>
            {mine.length === 0 ? (
              <p className="text-sm text-fg-muted">No teams yet.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {mine.map((pk) => (
                  <li key={pk.pickNumber} className="flex items-center gap-1.5" title={teamNames[pk.teamKey]}>
                    <BumperPlate number={teamLabel(pk.teamKey)} size="sm" />
                    {pk.auto ? <span className="text-[12px] text-fg-muted">auto</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 8: Add `highlightPick` to `components/DraftBoard.tsx`**

Add `highlightPick?: number;` to the props type and `highlightPick,` to the destructuring. Replace the cell's opening `<li key={n} className="flex min-w-0 flex-col items-center gap-1">` with:

```tsx
                <li
                  key={n}
                  data-newest={highlightPick === n ? 'true' : undefined}
                  className={`flex min-w-0 flex-col items-center gap-1 ${highlightPick === n ? 'rounded-xl ring-2 ring-accent' : ''}`}
                >
```

- [ ] **Step 9: Run the tests**

Run: `npx vitest run tests/ui/draft-components.test.ts tests/ui/round-components.test.ts && npm run typecheck`
Expected: PASS (the v1 board tests still pass: `highlightPick` is optional).

- [ ] **Step 10: Commit**

```bash
git add components/draft components/DraftBoard.tsx tests/ui/draft-components.test.ts
git commit -m "feat(draft): draft room banner, pool list, queue, confirm sheet, rosters"
```

---

### Task 14: The draft room — `useDraftRoom`, `<DraftRoom>`, and `/l/{slug}/r/{roundId}/draft`

**Files:**
- Create: `components/draft/useDraftRoom.ts`
- Create: `components/draft/DraftRoom.tsx`
- Create: `app/l/[slug]/r/[roundId]/draft/page.tsx`
- Test: `tests/config/dynamic-exports.test.ts` covers the page; behavior is checked in the browser (Step 6) and by E2E (Task 17). The logic inside the hook is already unit-tested in Tasks 2 and 12.

**Interfaces:**
- Consumes: `draftApi`/`DraftApiError` (Task 12), `createRefetcher`/`pollIntervalMs`/`shouldTick`/`titleFrame` (Task 12), `clockOffset`/`remainingMs` (Task 2), `draftTopic`/`DOORBELL_EVENT` (Task 4), v1 `usePolling` (`components/admin/usePolling.ts`), SP1 `createBrowserSupabase()` (`lib/supabase/browser.ts`) and `requireLeagueView`, Task 13 components.
- Produces:
  - `useDraftRoom(slug, roundId, baseTitle)` → `{ api, state, pool, remaining, reconnecting, loadError, subscribed, refetchNow }`
  - `<DraftRoom slug roundId eventName />`
  - Page `/l/{slug}/r/{roundId}/draft` (spec §7.6): members interact, `link`-league non-members watch read-only, `members` leagues show SP1's `PrivateLeague` card (`components/PrivateLeague.tsx`, SP1 Task 14), commissioner-mode rounds point back to the round page.

- [ ] **Step 1: Create the hook `components/draft/useDraftRoom.ts`**

```ts
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePolling } from '@/components/admin/usePolling';
import { DraftApiError, draftApi } from '@/lib/draft/api';
import { createRefetcher, pollIntervalMs, shouldTick, titleFrame, type Refetcher } from '@/lib/draft/client';
import { clockOffset, remainingMs } from '@/lib/draft/live';
import type { DraftState } from '@/lib/draft/state';
import type { PoolEntry } from '@/lib/pool/entries';
import { DOORBELL_EVENT, draftTopic } from '@/lib/realtime/doorbell';
import { createBrowserSupabase } from '@/lib/supabase/browser';

/**
 * Keeps one phone in sync with the live draft (spec §7.5): Realtime "doorbell" → rate-limited refetch,
 * polling as a fallback, a server-corrected countdown, timeout ticks, and the "Your pick!" title flash.
 */
export function useDraftRoom(slug: string, roundId: string, baseTitle: string) {
  const api = useMemo(() => draftApi(slug, roundId), [slug, roundId]);
  const [state, setState] = useState<DraftState | null>(null);
  const [pool, setPool] = useState<PoolEntry[] | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [subscribed, setSubscribed] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    const sentAt = Date.now();
    try {
      const s = await api.state();
      setOffsetMs(clockOffset(s.serverNow, sentAt, Date.now()));
      setState(s);
      setReconnecting(false);
      setLoadError(null);
    } catch (err) {
      // An HTTP error (private league, deleted round) is a real message; anything else is the network.
      if (err instanceof DraftApiError) setLoadError(err.message);
      else setReconnecting(true);
    }
  }, [api]);

  const refetcher = useRef<Refetcher | null>(null);
  useEffect(() => {
    const r = createRefetcher({
      fetch: load,
      now: () => Date.now(),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id as number),
    });
    refetcher.current = r;
    r.refetchNow();
    api.pool().then(setPool, () => setPool([]));
    return () => r.stop();
  }, [api, load]);
  const ring = useCallback(() => refetcher.current?.ring(), []);
  const refetchNow = useCallback(() => refetcher.current?.refetchNow(), []);

  // The doorbell: an empty broadcast on draft:{roundId} means "something changed — refetch".
  useEffect(() => {
    const supabase = createBrowserSupabase();
    const channel = supabase
      .channel(draftTopic(roundId))
      .on('broadcast', { event: DOORBELL_EVENT }, () => ring())
      .subscribe((status) => setSubscribed(status === 'SUBSCRIBED'));
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roundId, ring]);

  // Polling fallback: every 3 s without Realtime, 15 s with it, and right away when the tab is shown again.
  usePolling(async () => ring(), pollIntervalMs(subscribed), { paused: false });

  // The local countdown (4× a second) and timeout ticks (§7.4).
  const live = useRef({ state, offsetMs });
  useEffect(() => {
    live.current = { state, offsetMs };
  });
  const lastTickAt = useRef<number | null>(null);
  useEffect(() => {
    lastTickAt.current = null; // a new pick gets fresh tick timing
  }, [state?.pickNumber]);
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      const s = live.current.state;
      if (
        s &&
        shouldTick({
          phase: s.phase,
          deadline: s.deadline,
          isMember: Boolean(s.me),
          offsetMs: live.current.offsetMs,
          localNowMs: now,
          lastTickAtMs: lastTickAt.current,
        })
      ) {
        lastTickAt.current = now;
        api.tick(s.pickNumber).then(
          (r) => {
            if (r.picked) refetchNow();
          },
          () => {},
        );
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [api, refetchNow]);

  // Your turn: flash the tab title and buzz once (Android; iOS ignores vibrate).
  const myTurn = Boolean(state?.me) && state?.phase === 'live' && state?.onClock?.playerId === state?.me?.playerId;
  useEffect(() => {
    if (!myTurn) return;
    try {
      navigator.vibrate?.(200);
    } catch {
      // Some browsers throw instead of ignoring it.
    }
    let frame = 0;
    document.title = titleFrame(baseTitle, true, frame++);
    const id = window.setInterval(() => {
      document.title = titleFrame(baseTitle, true, frame++);
    }, 1000);
    return () => {
      window.clearInterval(id);
      document.title = baseTitle;
    };
  }, [myTurn, baseTitle]);

  const remaining = remainingMs(state?.deadline ?? null, offsetMs, nowMs);
  return { api, state, pool, remaining, reconnecting, loadError, subscribed, refetchNow };
}
```

- [ ] **Step 2: Create `components/draft/DraftRoom.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { ConfirmSheet } from '@/components/draft/ConfirmSheet';
import { DraftRoomBanner } from '@/components/draft/DraftRoomBanner';
import { DraftRosters } from '@/components/draft/DraftRosters';
import { PoolList } from '@/components/draft/PoolList';
import { QueueList } from '@/components/draft/QueueList';
import { useDraftRoom } from '@/components/draft/useDraftRoom';
import { DraftBoard } from '@/components/DraftBoard';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { DraftApiError } from '@/lib/draft/api';
import type { PoolEntry } from '@/lib/pool/entries';
import { teamLabel } from '@/lib/teams';

type Tab = 'pool' | 'queue' | 'board' | 'rosters';
const MAX_QUEUE = 100;

export function DraftRoom({ slug, roundId, eventName }: { slug: string; roundId: string; eventName: string }) {
  const room = useDraftRoom(slug, roundId, `${eventName} draft`);
  const { api, state, pool } = room;
  const [tab, setTab] = useState<Tab>('pool');
  const [confirming, setConfirming] = useState<PoolEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (room.loadError && !state) return <Alert tone="danger">{room.loadError}</Alert>;
  if (!state || !pool) return <p className="text-[15px] text-fg-muted">Loading the draft…</p>;

  const me = state.me ?? null;
  const taken = new Set(state.picks.map((p) => p.teamKey));
  const teamNames = Object.fromEntries(pool.flatMap((e) => (e.nickname ? [[e.teamKey, e.nickname]] : [])));
  const playerNames = Object.fromEntries(state.order.map((o) => [o.playerId, o.name]));
  const myTurn = Boolean(me) && state.phase === 'live' && state.onClock?.playerId === me?.playerId;
  // A commissioner can pick for whoever is on the clock (§7.3 "Pick for Mom").
  const pickingFor = !myTurn && me?.isCommissioner && state.phase === 'live' ? state.onClock : null;
  const lastPick = state.picks[state.picks.length - 1] ?? null;

  /** Runs one action; on any outcome, refetch. 409 stale/not_your_turn refetch silently (§7.6). */
  async function run(action: () => Promise<unknown>, pickedTeam?: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      if (err instanceof DraftApiError) {
        if (err.code === 'taken' && pickedTeam) setNotice(`${teamLabel(pickedTeam)} was just taken — pick again`);
        else if (err.code !== 'stale' && err.code !== 'not_your_turn') setNotice(err.message);
      } else {
        setNotice("Couldn't reach the server. Check your connection and try again.");
      }
    } finally {
      setBusy(false);
      setConfirming(null);
      room.refetchNow();
    }
  }

  function confirmPick() {
    if (!confirming || !state) return;
    const teamKey = confirming.teamKey;
    void run(
      () => (pickingFor ? api.pickFor(state.pickNumber, teamKey) : api.pick(state.pickNumber, teamKey)),
      teamKey,
    );
  }

  function toggleQueue(teamKey: string) {
    if (!me) return;
    const next = me.queue.includes(teamKey) ? me.queue.filter((k) => k !== teamKey) : [...me.queue, teamKey];
    if (next.length > MAX_QUEUE) {
      setNotice(`A queue can hold at most ${MAX_QUEUE} teams`);
      return;
    }
    void run(() => api.setQueue(next));
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'pool', label: 'Pool' },
    ...(me ? [{ id: 'queue' as const, label: `Queue${me.queue.length ? ` (${me.queue.filter((k) => !taken.has(k)).length})` : ''}` }] : []),
    { id: 'board', label: 'Board' },
    { id: 'rosters', label: 'Rosters' },
  ];

  return (
    <div className="space-y-4">
      <DraftRoomBanner
        state={state}
        remainingMs={room.remaining}
        meId={me?.playerId ?? null}
        reconnecting={room.reconnecting}
      />

      {notice ? (
        <Alert tone="warning" className="flex items-start justify-between gap-2">
          {notice}
        </Alert>
      ) : null}

      {me ? (
        <details className="rounded-xl border border-border bg-surface px-3 py-2">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-fg">Draft options</summary>
          <div className="space-y-3 pt-2 pb-1">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-fg">
              <input
                type="checkbox"
                className="size-5"
                checked={me.autodraft}
                disabled={busy || state.phase === 'done'}
                onChange={(ev) => void run(() => api.setAutodraft(ev.target.checked))}
              />
              Auto-draft for me
            </label>
            {me.isCommissioner ? (
              <div className="flex flex-wrap gap-2">
                {state.phase === 'live' ? (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => api.control('pause'))}>
                    Pause
                  </Button>
                ) : null}
                {state.phase === 'paused' ? (
                  <Button size="sm" disabled={busy} onClick={() => void run(() => api.control('resume'))}>
                    Resume
                  </Button>
                ) : null}
                {lastPick && state.phase !== 'setup' ? (
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      const label = `${teamLabel(lastPick.teamKey)} (${playerNames[lastPick.playerId] ?? 'Unknown'})`;
                      if (window.confirm(`Undo the last pick: ${label}?`)) void run(() => api.undo(lastPick.pickNumber));
                    }}
                  >
                    Undo last pick
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </details>
      ) : (
        <p className="text-[15px] text-fg-muted">You&apos;re watching. Only league members can draft.</p>
      )}

      <div role="tablist" aria-label="Draft room" className="grid grid-cols-4 gap-1 rounded-pill bg-surface-2 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-11 cursor-pointer rounded-pill px-2 text-[14px] font-semibold ${
              tab === t.id ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'pool' ? (
          <PoolList
            entries={pool}
            taken={taken}
            queued={new Set(me?.queue ?? [])}
            canDraft={!busy && (myTurn || Boolean(pickingFor))}
            draftLabel={pickingFor ? `Pick for ${pickingFor.name}` : 'Draft'}
            readOnly={!me}
            onDraft={setConfirming}
            onToggleQueue={toggleQueue}
          />
        ) : null}
        {tab === 'queue' && me ? (
          <QueueList
            queue={me.queue}
            teamNames={teamNames}
            taken={taken}
            disabled={busy}
            onChange={(next) => void run(() => api.setQueue(next))}
          />
        ) : null}
        {tab === 'board' ? (
          <DraftBoard
            picks={state.picks}
            draftOrder={state.order.map((o) => o.playerId)}
            rosterSize={state.rosterSize}
            playerNames={playerNames}
            teamNames={teamNames}
            highlightPick={lastPick?.pickNumber}
          />
        ) : null}
        {tab === 'rosters' ? (
          <DraftRosters order={state.order} picks={state.picks} rosterSize={state.rosterSize} teamNames={teamNames} />
        ) : null}
      </div>

      {confirming ? (
        <ConfirmSheet
          entry={confirming}
          forName={pickingFor?.name ?? null}
          busy={busy}
          onConfirm={confirmPick}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Create the page `app/l/[slug]/r/[roundId]/draft/page.tsx`**

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DraftRoom } from '@/components/draft/DraftRoom';
import { PrivateLeague } from '@/components/PrivateLeague';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChevronLeft } from '@/components/ui/icons';
import { HttpError, isUuid } from '@/lib/api/http';
import { requireLeagueView } from '@/lib/auth/roles';
import { getUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string; roundId: string }> };

export default async function DraftRoomPage({ params }: Props) {
  const { slug, roundId } = await params;
  let view: Awaited<ReturnType<typeof requireLeagueView>>;
  try {
    view = await requireLeagueView(slug);
  } catch (err) {
    if (err instanceof HttpError && err.status === 403) {
      // SP1's card (SP1 Task 14): explains itself and offers sign-in with `next` back here.
      const user = await getUser();
      return <PrivateLeague signedIn={user !== null} next={`/l/${slug}/r/${roundId}/draft`} />;
    }
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }
  if (!isUuid(roundId)) notFound();
  const round = await getRepo().getRound(roundId);
  if (!round || round.leagueId !== view.league.id) notFound();

  const back = (
    <Link
      href={`/l/${slug}/r/${round.id}`}
      className="-ml-2 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg pr-3 pl-1 text-[15px] font-semibold text-primary hover:bg-surface-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronLeft className="size-5 shrink-0" />
      {round.eventName}
    </Link>
  );

  if (round.draftMode !== 'live') {
    return (
      <main id="main" className="space-y-4">
        {back}
        <Card title="No live draft for this round">
          <p className="text-[15px] text-fg">The commissioner enters this round&apos;s picks.</p>
          <Button href={`/l/${slug}/r/${round.id}`} variant="secondary" className="mt-4">
            See the draft board
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <main id="main" className="space-y-3">
      {back}
      <h1 className="font-display text-[28px] font-bold leading-[30px] text-fg">{round.eventName} draft</h1>
      <DraftRoom slug={slug} roundId={round.id} eventName={round.eventName} />
    </main>
  );
}
```

(The private card is SP1's `PrivateLeague` component.)

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: clean; all tests pass (the dynamic-exports test now also checks the new page).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: the build succeeds. It fails if a client component (`useDraftRoom`, `DraftRoom`, `lib/draft/api.ts`) accidentally imports server-only code (`lib/db`, `node:crypto`) — fix any such import with `import type`.

- [ ] **Step 6: Try it in two browsers (Joey or the controller)**

1. `npm run dev`. In the Supabase SQL Editor nothing is needed (Task 1 applied the migration).
2. Sign in as two different accounts: one normal window and one private window. If Google/Discord for a second account is inconvenient, use SP1's test login: add `E2E_AUTH_SECRET=<anything>` to `.env.local`, restart dev, then in the private window's devtools console run `fetch('/api/test/login', { method: 'POST', headers: { authorization: 'Bearer <secret>', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'mom-test@example.com' }) }).then(() => location.reload())`.
3. As the commissioner, open a league round's admin page. In the "Live draft" card (Task 15 adds it; until then set it with `PATCH` via the admin UI's network tab, or do Task 15 first and come back) choose **Live draft**, timer **30 s**, set the draft order with both accounts, and press **Start draft**.
4. Open `/l/{slug}/r/{roundId}/draft` in both windows at **360 px** width (devtools device mode), in **both themes**. Check: banner "On the clock: … · 0:29" counting down in both windows in step; your window's title flashes "Your pick!"; Draft → confirm sheet "Draft 1?" → the other window updates within ~1 s; the queue +/↑/↓/× work; letting the clock run out auto-picks (the first queued team, else the lowest number); Pause/Resume/Undo from Draft options; no horizontal scrolling anywhere.
5. Turn off wifi in one window (devtools → Network → Offline): "Reconnecting…" appears and the countdown keeps going; back online, it clears.

- [ ] **Step 7: Commit**

```bash
git add components/draft/useDraftRoom.ts components/draft/DraftRoom.tsx "app/l/[slug]/r/[roundId]/draft/page.tsx"
git commit -m "feat(draft): live draft room page with Realtime, polling, countdown, and ticks"
```

---

### Task 15: "Draft is live — join" banners and commissioner live-draft controls

**Files:**
- Create: `components/draft/LiveDraftBanner.tsx`
- Create: `lib/draft/liveBanner.ts`
- Modify: `app/l/[slug]/page.tsx`, `app/l/[slug]/r/[roundId]/page.tsx` (show the banner)
- Modify: `lib/api/types.ts` (`AdminRoundDetail.round` draft fields + `draftPhase`), `lib/rounds/detail.ts`
- Create: `components/admin/LiveDraftControls.tsx`
- Modify: `components/admin/RoundAdmin.tsx` (render it)
- Test: `tests/draft/liveBanner.test.ts` (new), `tests/ui/draft-components.test.ts` (extend), `tests/api/draftAdmin.test.ts` (extend)

**Interfaces:**
- Consumes: `draftPhase` (Task 2); SP1 `getUser()`, `Repo.getMemberByUser(leagueId, userId)`; v1 `RoundView` (`{ round: RoundRow; picks: PickRow[]; … }`); `PICK_SECONDS` (Task 1).
- Produces:
  - `type LiveDraft = { roundId: string; eventName: string; phase: 'live' | 'paused' }`
  - `liveDraftsOf(views: { round: RoundRow; picks: unknown[] }[]): LiveDraft[]` (pure)
  - `memberLiveDrafts(slug: string, views: …): Promise<LiveDraft[]>` — empty unless the signed-in user is a member
  - `<LiveDraftBanner slug drafts />`
  - `AdminRoundDetail.round` gains `draftMode`, `pickSeconds`, `draftStartedAt`, `draftPausedAt`; `AdminRoundDetail.draftPhase: DraftPhase`
  - `<LiveDraftControls {...SectionProps} slug />`

- [ ] **Step 1: Write the failing tests**

Create `tests/draft/liveBanner.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { RoundRow } from '@/lib/db/types';
import { liveDraftsOf } from '@/lib/draft/liveBanner';

const round = (id: string, over: Partial<RoundRow> = {}) =>
  ({
    id, eventName: `Event ${id}`, draftMode: 'live', draftStartedAt: '2026-10-23T23:00:00Z', draftPausedAt: null,
    rosterSize: 2, draftOrder: ['a', 'b'], ...over,
  }) as RoundRow;

describe('liveDraftsOf (§7.6)', () => {
  it('lists live and paused drafts only', () => {
    const views = [
      { round: round('live'), picks: [1] },
      { round: round('paused', { draftPausedAt: '2026-10-23T23:05:00Z' }), picks: [] },
      { round: round('setup', { draftStartedAt: null }), picks: [] },
      { round: round('done'), picks: [1, 2, 3, 4] },
      { round: round('v1', { draftMode: 'commissioner', draftStartedAt: null }), picks: [1] },
    ];
    expect(liveDraftsOf(views)).toEqual([
      { roundId: 'live', eventName: 'Event live', phase: 'live' },
      { roundId: 'paused', eventName: 'Event paused', phase: 'paused' },
    ]);
  });
});
```

Add to `tests/ui/draft-components.test.ts`:

```ts
import { LiveDraftBanner } from '@/components/draft/LiveDraftBanner';
import { LiveDraftControls } from '@/components/admin/LiveDraftControls';
import type { AdminRoundDetail } from '@/lib/api/types';

describe('LiveDraftBanner', () => {
  it('links members to the draft room', () => {
    const html = renderToStaticMarkup(h(LiveDraftBanner, { slug: 'fam', drafts: [{ roundId: 'r1', eventName: 'Ramp Riot', phase: 'live' }] }));
    expect(html).toContain('href="/l/fam/r/r1/draft"');
    expect(text(html)).toContain('Draft is live — join');
    expect(renderToStaticMarkup(h(LiveDraftBanner, { slug: 'fam', drafts: [] }))).toBe('');
  });
});

describe('LiveDraftControls', () => {
  const detail = (over: Partial<AdminRoundDetail['round']>, draftPhase: AdminRoundDetail['draftPhase']) =>
    ({
      round: { id: 'r1', draftMode: 'live', pickSeconds: 60, draftStartedAt: null, draftPausedAt: null, ...over },
      draftPhase,
      picks: [],
    }) as unknown as AdminRoundDetail;
  const props = (d: AdminRoundDetail) => ({ detail: d, busy: false, run: async () => {}, api: (async () => ({})) as never, playerNames: {}, slug: 'fam' });

  it('offers Start before the draft and Resume while paused', () => {
    expect(text(renderToStaticMarkup(h(LiveDraftControls, props(detail({}, 'setup')))))).toContain('Start draft');
    const paused = text(renderToStaticMarkup(h(LiveDraftControls, props(detail({ draftStartedAt: 'x', draftPausedAt: 'y' }, 'paused')))));
    expect(paused).toContain('Resume');
    expect(paused).not.toContain('Start draft');
  });
  it('hides the timer for commissioner-entered drafts', () => {
    const t = text(renderToStaticMarkup(h(LiveDraftControls, props(detail({ draftMode: 'commissioner' }, 'setup')))));
    expect(t).not.toContain('Pick timer');
    expect(t).not.toContain('Start draft');
  });
});
```

Add to `tests/api/draftAdmin.test.ts` inside `describe('PATCH round draft settings (§7.3)', …)`:

```ts
  it('the admin round detail carries the draft settings and phase', async () => {
    const s = await seedLiveDraft(mocks.repo, { mode: 'commissioner' });
    mocks.user = s.joeyUser;
    const body = await readJson(await patch(s, { draftMode: 'live', pickSeconds: 30 }));
    expect(body.round).toMatchObject({ draftMode: 'live', pickSeconds: 30, draftStartedAt: null, draftPausedAt: null });
    expect(body.draftPhase).toBe('setup');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/draft/liveBanner.test.ts tests/ui/draft-components.test.ts tests/api/draftAdmin.test.ts`
Expected: FAIL — modules missing; `body.round.draftMode` undefined.

- [ ] **Step 3: Create `lib/draft/liveBanner.ts`**

```ts
import { getUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';
import type { RoundRow } from '@/lib/db/types';
import { draftPhase } from '@/lib/draft/live';

export type LiveDraft = { roundId: string; eventName: string; phase: 'live' | 'paused' };

export function liveDraftsOf(views: { round: RoundRow; picks: unknown[] }[]): LiveDraft[] {
  return views.flatMap(({ round, picks }) => {
    const phase = draftPhase(round, picks.length);
    return phase === 'live' || phase === 'paused' ? [{ roundId: round.id, eventName: round.eventName, phase }] : [];
  });
}

/** Spec §7.6: signed-in members see a "Draft is live — join" banner. Everyone else sees nothing. */
export async function memberLiveDrafts(
  slug: string,
  views: { round: RoundRow; picks: unknown[] }[],
): Promise<LiveDraft[]> {
  const drafts = liveDraftsOf(views);
  if (drafts.length === 0) return [];
  const user = await getUser();
  if (!user) return [];
  const repo = getRepo();
  const league = await repo.getLeagueBySlug(slug);
  if (!league) return [];
  return (await repo.getMemberByUser(league.id, user.id)) ? drafts : [];
}
```

- [ ] **Step 4: Create `components/draft/LiveDraftBanner.tsx`**

```tsx
import Link from 'next/link';
import { ArrowRight } from '@/components/ui/icons';
import type { LiveDraft } from '@/lib/draft/liveBanner';

export function LiveDraftBanner({ slug, drafts }: { slug: string; drafts: LiveDraft[] }) {
  if (drafts.length === 0) return null;
  return (
    <div className="space-y-2">
      {drafts.map((d) => (
        <Link
          key={d.roundId}
          href={`/l/${slug}/r/${d.roundId}/draft`}
          className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-card bg-accent px-4 py-3 text-on-accent hover:bg-accent-strong focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0">
            <span className="block font-semibold">Draft is live — join</span>
            <span className="block truncate text-[13px]">
              {d.eventName}
              {d.phase === 'paused' ? ' · paused' : ''}
            </span>
          </span>
          <ArrowRight className="size-5 shrink-0" />
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Show it on the league and round pages**

In `app/l/[slug]/page.tsx`, add imports:

```tsx
import { LiveDraftBanner } from '@/components/draft/LiveDraftBanner';
import { memberLiveDrafts } from '@/lib/draft/liveBanner';
```

After the page data is loaded (right after the line that reads `page.rounds` / computes `live`), add `const drafts = await memberLiveDrafts(slug, page.rounds);` and render `<LiveDraftBanner slug={slug} drafts={drafts} />` as the first element inside `<main>` after `<AutoRefresh … />`. While a draft is live, the league page's `<AutoRefresh seconds={60} />` keeps the banner reasonably fresh; the draft room itself is realtime.

In `app/l/[slug]/r/[roundId]/page.tsx`, add the same imports, `const drafts = await memberLiveDrafts(slug, [view]);` after `const { round } = view;`, and render `<LiveDraftBanner slug={league.slug} drafts={drafts} />` right after `<AutoRefresh seconds={60} />`.

- [ ] **Step 6: Add the draft fields to the admin round detail**

In `lib/api/types.ts`, add `import type { DraftPhase } from '@/lib/draft/live';` and `import type { DraftMode, PickSeconds } from '@/lib/db/types';`, then add to `AdminRoundDetail.round`:

```ts
    draftMode: DraftMode;
    pickSeconds: PickSeconds | null;
    draftStartedAt: string | null;
    draftPausedAt: string | null;
```

and to `AdminRoundDetail`:

```ts
  /** Live-draft phase (v2 §7.1); 'setup' until started, for commissioner-mode rounds until full. */
  draftPhase: DraftPhase;
```

In `lib/rounds/detail.ts`, add `import { draftPhase } from '@/lib/draft/live';`, add to the returned `round` object:

```ts
      draftMode: round.draftMode,
      pickSeconds: round.pickSeconds,
      draftStartedAt: round.draftStartedAt,
      draftPausedAt: round.draftPausedAt,
```

and at the top level `draftPhase: draftPhase(round, picks.length),`.

- [ ] **Step 7: Create `components/admin/LiveDraftControls.tsx`**

```tsx
'use client';

import type { SectionProps } from '@/components/admin/RoundAdmin';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { PICK_SECONDS } from '@/lib/db/types';

/** Spec §7.3 commissioner controls: draft mode and timer (before start / while paused), Start, Pause, Resume. */
export function LiveDraftControls({ detail, busy, run, api, slug }: SectionProps & { slug: string }) {
  const { round } = detail;
  const phase = detail.draftPhase;
  const started = round.draftStartedAt !== null;
  const patch = (body: object, done: string) => run(() => api(`/rounds/${round.id}`, { method: 'PATCH', body }), done);
  const control = (action: 'start' | 'pause' | 'resume', done: string) =>
    run(() => api(`/rounds/${round.id}/draft/${action}`, { method: 'POST' }), done);

  return (
    <div className="space-y-4">
      <Select
        label="How picks are made"
        value={round.draftMode}
        disabled={busy || started || detail.picks.length > 0}
        onChange={(ev) => void patch({ draftMode: ev.target.value }, 'Draft mode saved')}
      >
        <option value="commissioner">Commissioner enters picks</option>
        <option value="live">Live draft on everyone&apos;s phones</option>
      </Select>

      {round.draftMode === 'live' ? (
        <>
          <Select
            label="Pick timer"
            value={round.pickSeconds === null ? 'off' : String(round.pickSeconds)}
            disabled={busy || (started && phase !== 'paused')}
            onChange={(ev) =>
              void patch({ pickSeconds: ev.target.value === 'off' ? null : Number(ev.target.value) }, 'Timer saved')
            }
          >
            <option value="off">Off (no time limit)</option>
            {PICK_SECONDS.map((s) => (
              <option key={s} value={s}>
                {s} seconds
              </option>
            ))}
          </Select>
          <div className="flex flex-wrap gap-2">
            {phase === 'setup' ? (
              <Button disabled={busy} onClick={() => void control('start', 'Draft started')}>
                Start draft
              </Button>
            ) : null}
            {phase === 'live' ? (
              <Button variant="secondary" disabled={busy} onClick={() => void control('pause', 'Draft paused')}>
                Pause
              </Button>
            ) : null}
            {phase === 'paused' ? (
              <Button disabled={busy} onClick={() => void control('resume', 'Draft resumed')}>
                Resume
              </Button>
            ) : null}
            <Button variant="secondary" href={`/l/${slug}/r/${round.id}/draft`}>
              Open draft room
            </Button>
          </div>
          <p className="text-sm text-fg-muted">
            Everyone drafts from their own phone. Undo and &ldquo;Pick for&rdquo; work in the draft room and in the
            draft entry below.
          </p>
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 8: Render it in the round admin**

In `components/admin/RoundAdmin.tsx`, import `LiveDraftControls` and add a section right before the `<section>` that holds `<Card title="Draft">`:

```tsx
      <section>
        <Card title="Live draft">
          <LiveDraftControls {...section} slug={slug} />
        </Card>
      </section>
```

(`slug` is already a prop of `RoundManager`; if `section` is built inside it, pass `slug` explicitly as shown.)

- [ ] **Step 9: Run the tests and typecheck**

Run: `npx vitest run tests/draft/liveBanner.test.ts tests/ui/draft-components.test.ts tests/api/draftAdmin.test.ts && npm run typecheck && npm test`
Expected: PASS; all green.

- [ ] **Step 10: Commit**

```bash
git add components/draft/LiveDraftBanner.tsx lib/draft/liveBanner.ts "app/l/[slug]/page.tsx" "app/l/[slug]/r/[roundId]/page.tsx" lib/api/types.ts lib/rounds/detail.ts components/admin/LiveDraftControls.tsx components/admin/RoundAdmin.tsx tests/draft/liveBanner.test.ts tests/ui/draft-components.test.ts tests/api/draftAdmin.test.ts
git commit -m "feat(draft): join banners for members and commissioner live-draft controls"
```

---

### Task 16: Real-database smoke script — races, undo vs tick, pause floor, RLS and RPC lockdown

**Files:**
- Create: `scripts/smoke-v2.ts`

**Interfaces:**
- Consumes: the three SQL functions (Task 1) through `Repo.makePickAtomic/undoPickAtomic/draftControl/rlsDisabledTables` (Task 3); `createSupabaseClient`/`createSupabaseRepo`.
- Produces: `npx tsx --env-file=.env.local scripts/smoke-v2.ts` prints `ok`/`FAIL` lines and exits non-zero on any failure. It creates one throwaway league and deletes it at the end. SP3 and SP2 extend this script.

This is the proof that the SQL behaves like the memory repo. The memory repo can't show real concurrency; Postgres row locks can.

- [ ] **Step 1: Write the script**

Create `scripts/smoke-v2.ts`:

```ts
// Real-database checks for v2 (spec §8.1, §9). Creates a throwaway league and deletes it afterwards.
// Usage: npx tsx --env-file=.env.local scripts/smoke-v2.ts
import { createClient } from '@supabase/supabase-js';
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';
import { defaultScoring } from '@/lib/scoring/config';

function check(label: string, ok: boolean) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const db = createSupabaseClient();
  const repo = createSupabaseRepo(db);

  const noRls = await repo.rlsDisabledTables();
  check(`RLS is on for every public table${noRls.length ? ` (OFF: ${noRls.join(', ')})` : ''}`, noRls.length === 0);

  // Direct inserts keep this script independent of the app's create-league flow.
  const slug = `smoke-v2-${Date.now().toString(36)}`;
  const inserted = await db.from('leagues').insert({ slug, name: 'Smoke v2', default_scoring: defaultScoring() }).select().single();
  if (inserted.error) throw new Error(inserted.error.message);
  const leagueId = inserted.data.id as string;

  try {
    const players = await db
      .from('players')
      .insert([{ league_id: leagueId, name: 'Smoke A' }, { league_id: leagueId, name: 'Smoke B' }])
      .select();
    if (players.error) throw new Error(players.error.message);
    const [a, b] = players.data as { id: string }[];
    const round = await repo.createRound({
      leagueId, eventKey: '2025parr', eventName: 'Ramp Riot',
      startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
    });
    await repo.updateRound(round.id, { draftOrder: [a.id, b.id], rosterSize: 3, draftMode: 'live', pickSeconds: 30 });
    const pick = (pickNumber: number, playerId: string, teamKey: string, requireDue = false) =>
      repo.makePickAtomic({ roundId: round.id, pickNumber, playerId, teamKey, requireDue, auto: requireDue });

    check('a live draft starts once', (await repo.draftControl(round.id, 'start')) && !(await repo.draftControl(round.id, 'start')));

    const racing = await Promise.all(['frc1', 'frc2', 'frc3', 'frc4', 'frc5'].map((t) => pick(0, a.id, t)));
    check('five phones racing for one pick: exactly one wins', racing.filter(Boolean).length === 1);
    check('…and exactly one pick is saved', (await repo.listPicks(round.id)).length === 1);

    const taken = (await repo.listPicks(round.id))[0].teamKey;
    check('a taken team is refused without an error', !(await pick(1, b.id, taken)));
    check('a timeout pick before the deadline is refused', !(await pick(1, b.id, 'frc6', true)));

    // Undo racing a timeout tick, with the deadline already passed.
    await db.from('rounds').update({ pick_deadline: new Date(Date.now() - 5_000).toISOString() }).eq('id', round.id);
    const [undone, ticked] = await Promise.all([repo.undoPickAtomic(round.id, 0), pick(1, b.id, 'frc7', true)]);
    const count = (await repo.listPicks(round.id)).length;
    check('undo racing a tick: exactly one of them happens', undone !== ticked);
    check('…and the pick count agrees', count === (undone ? 0 : 2));
    const afterRace = (await repo.getRound(round.id))!;
    check('…and the next deadline is in the future', afterRace.pickDeadline !== null && Date.parse(afterRace.pickDeadline) > Date.now());

    // Pause after the clock ran out → resume gives ~10 s (spec §7.1).
    await db.from('rounds').update({ pick_deadline: new Date(Date.now() - 5_000).toISOString() }).eq('id', round.id);
    await repo.draftControl(round.id, 'pause');
    check('pausing after the deadline keeps 0 ms, not a negative number', (await repo.getRound(round.id))!.pausedRemainingMs === 0);
    check('picks are refused while paused', !(await pick(count, count % 2 === 0 ? a.id : b.id, 'frc8')));
    await repo.draftControl(round.id, 'resume');
    const left = Date.parse((await repo.getRound(round.id))!.pickDeadline!) - Date.now();
    check(`resume gives about 10 s (${left} ms)`, left > 8_000 && left <= 10_500);

    // The anon key is public in v2: it must not reach tables or functions.
    const url = process.env.SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!anonKey) {
      check('NEXT_PUBLIC_SUPABASE_ANON_KEY is set in .env.local (needed for the next two checks)', false);
    } else {
      const anon = createClient(url, anonKey, { auth: { persistSession: false } });
      const rpc = await anon.rpc('draft_make_pick', {
        p_round_id: round.id, p_pick_number: 0, p_player_id: a.id, p_team_key: 'frc9',
        p_require_due: false, p_auto: false,
      });
      check('the anon key cannot call draft_make_pick', rpc.error !== null);
      const rows = await anon.from('picks').select('id').eq('round_id', round.id);
      check('the anon key reads no rows (RLS, no policies)', (rows.data ?? []).length === 0);
    }
  } finally {
    await db.from('leagues').delete().eq('id', leagueId);
    console.log('cleaned up the throwaway league');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run it against the real project**

Run: `npx tsx --env-file=.env.local scripts/smoke-v2.ts`
Expected: every line starts with `ok`, then `cleaned up the throwaway league`. Wake the Supabase project in the dashboard first if it has been idle for a week. If "resume gives about 10 s" fails by a few hundred ms, the laptop clock is off from the database clock; re-run (the check allows 8–10.5 s).

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke-v2.ts
git commit -m "test(draft): real-database smoke script for live-draft races and lockdown"
```

---

### Task 17: End-to-end test — two phones run a live draft (Playwright)

**Files:**
- Modify: `package.json` (dev dependency + `e2e` script)
- Create: `playwright.config.ts`, `e2e/helpers.ts`, `e2e/live-draft.spec.ts`
- Modify: `.gitignore` (`/test-results`, `/playwright-report`)

**Interfaces:**
- Consumes: SP1's test-only `POST /api/test/login` — works only when `E2E_AUTH_SECRET` is set, the request sends `Authorization: Bearer $E2E_AUTH_SECRET`, and `VERCEL` is unset (spec §8.1). **Assumed shape (confirm against SP1's route before running):** body `{ email: string, name?: string }`; it creates (or reuses) a Supabase user plus profile, sets the session cookie on the response, and returns `{ userId: string }`. Also `Repo.createMember` (SP1) and the Task 10 admin endpoints.
- Produces: `npm run e2e`.

- [ ] **Step 1: Install Playwright**

Run: `npm install -D @playwright/test && npx playwright install chromium`
Expected: `@playwright/test` appears in `devDependencies`. Add to `package.json` `scripts`: `"e2e": "playwright test"`. Add `/test-results` and `/playwright-report` to `.gitignore`.

- [ ] **Step 2: Create `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

// Loads E2E_AUTH_SECRET and the Supabase keys for the test's own seeding. Next.js reads .env.local itself.
try {
  process.loadEnvFile('.env.local');
} catch {
  // CI would pass real env vars instead.
}

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3100',
    viewport: { width: 360, height: 780 },
    trace: 'retain-on-failure',
  },
  webServer: {
    // A production build, the way phones will see it. VERCEL is unset locally, so the test login works.
    command: 'npm run build && npx next start -p 3100',
    url: 'http://localhost:3100',
    timeout: 300_000,
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 3: Create `e2e/helpers.ts`**

```ts
import type { BrowserContext } from '@playwright/test';
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';
import { defaultScoring } from '@/lib/scoring/config';

export async function signIn(context: BrowserContext, email: string, name: string): Promise<string> {
  const secret = process.env.E2E_AUTH_SECRET;
  if (!secret) throw new Error('Set E2E_AUTH_SECRET in .env.local to run the E2E tests');
  const res = await context.request.post('/api/test/login', {
    headers: { authorization: `Bearer ${secret}` },
    data: { email, name },
  });
  if (!res.ok()) throw new Error(`test login failed: ${res.status()} ${await res.text()}`);
  return ((await res.json()) as { userId: string }).userId;
}

/** A league where Joey (commissioner) and Mom (player) have a live, not-yet-started Ramp Riot round. */
export async function seedDraft(joeyId: string, momId: string) {
  const db = createSupabaseClient();
  const repo = createSupabaseRepo(db);
  const slug = `e2e-${Date.now().toString(36)}`;
  const inserted = await db.from('leagues').insert({ slug, name: 'E2E Draft', default_scoring: defaultScoring() }).select().single();
  if (inserted.error) throw new Error(inserted.error.message);
  const leagueId = inserted.data.id as string;
  const joey = await repo.createMember({ leagueId, userId: joeyId, name: 'Joey E2E', role: 'commissioner' });
  const mom = await repo.createMember({ leagueId, userId: momId, name: 'Mom E2E', role: 'player' });
  const round = await repo.createRound({
    leagueId, eventKey: '2025parr', eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
  });
  await repo.updateRound(round.id, { draftOrder: [joey.id, mom.id], rosterSize: 3, draftMode: 'live', pickSeconds: 30 });
  return { slug, leagueId, roundId: round.id };
}

export async function cleanup(leagueId: string, userIds: string[]) {
  const db = createSupabaseClient();
  await db.from('leagues').delete().eq('id', leagueId);
  for (const id of userIds) await db.auth.admin.deleteUser(id);
}
```

(Playwright resolves the `@/` alias from `tsconfig.json` `paths`.)

- [ ] **Step 4: Write the E2E test**

Create `e2e/live-draft.spec.ts`:

```ts
import { expect, test, type APIRequestContext } from '@playwright/test';
import { cleanup, seedDraft, signIn } from './helpers';

test('two phones run a live draft: pick, race, pause/resume, timeout, auto-draft, undo', async ({ browser }) => {
  const run = Date.now().toString(36);
  const joeyCtx = await browser.newContext();
  const momCtx = await browser.newContext();
  const joeyId = await signIn(joeyCtx, `e2e-joey-${run}@example.com`, 'Joey E2E');
  const momId = await signIn(momCtx, `e2e-mom-${run}@example.com`, 'Mom E2E');
  const seed = await seedDraft(joeyId, momId);
  const base = `/api/l/${seed.slug}/rounds/${seed.roundId}`;
  const admin = `/api/l/${seed.slug}/admin/rounds/${seed.roundId}`;
  const stateOf = async (req: APIRequestContext) => (await (await req.get(`${base}/draft/state`)).json());

  try {
    const joey = await joeyCtx.newPage();
    const mom = await momCtx.newPage();
    const room = `/l/${seed.slug}/r/${seed.roundId}/draft`;
    await joey.goto(room);
    await mom.goto(room);
    await expect(mom.getByText('Waiting for the commissioner to start the draft').first()).toBeVisible();

    // Start (snake order with roster 3: Joey, Mom, Mom, Joey, Joey, Mom).
    expect((await joeyCtx.request.post(`${admin}/draft/start`)).ok()).toBeTruthy();
    await expect(mom.getByText('On the clock: Joey E2E').first()).toBeVisible({ timeout: 5_000 });

    // 1. Joey picks from the Pool tab; Mom's phone updates within a few seconds.
    await joey.getByRole('button', { name: 'Draft', exact: true }).first().click();
    await joey.getByRole('dialog').getByRole('button', { name: 'Draft', exact: true }).click();
    await expect(mom.getByText('On the clock: Mom E2E').first()).toBeVisible({ timeout: 5_000 });
    await expect(mom.getByText('Your pick!').first()).toBeVisible();

    // 2. A racing double pick from Mom: one 201, one 409.
    const pool = (await (await momCtx.request.get(`${base}/pool`)).json()) as { teamKey: string; available: boolean }[];
    const [t1, t2] = pool.filter((e) => e.available).map((e) => e.teamKey);
    const [r1, r2] = await Promise.all([
      momCtx.request.post(`${base}/draft/pick`, { data: { expectedPickNumber: 1, teamKey: t1 } }),
      momCtx.request.post(`${base}/draft/pick`, { data: { expectedPickNumber: 1, teamKey: t2 } }),
    ]);
    expect([r1.status(), r2.status()].sort()).toEqual([201, 409]);
    expect((await stateOf(joeyCtx.request)).pickNumber).toBe(2);

    // 3. Pause and resume.
    expect((await joeyCtx.request.post(`${admin}/draft/pause`)).ok()).toBeTruthy();
    await expect(mom.getByText('Paused by commissioner').first()).toBeVisible({ timeout: 5_000 });
    expect((await joeyCtx.request.post(`${admin}/draft/resume`)).ok()).toBeTruthy();
    await expect(mom.getByText('On the clock: Mom E2E').first()).toBeVisible({ timeout: 5_000 });

    // 4. Mom lets the 30 s clock run out: the phones tick and the server auto-picks for her.
    await expect.poll(async () => (await stateOf(joeyCtx.request)).pickNumber, { timeout: 50_000 }).toBe(3);
    expect((await stateOf(joeyCtx.request)).picks[2]).toMatchObject({ auto: true });

    // 5. Joey turns on auto-draft while on the clock: picks 3 and 4 (both his) happen at once.
    await joey.getByText('Draft options').click();
    await joey.getByLabel('Auto-draft for me').check();
    await expect.poll(async () => (await stateOf(joeyCtx.request)).pickNumber, { timeout: 10_000 }).toBe(5);

    // 6. Joey (commissioner) undoes his last auto-pick: it stays undone and his auto-draft is off.
    joey.once('dialog', (d) => void d.accept());
    await joey.getByRole('button', { name: 'Undo last pick' }).click();
    await expect.poll(async () => (await stateOf(joeyCtx.request)).pickNumber, { timeout: 10_000 }).toBe(4);
    const after = await stateOf(joeyCtx.request);
    expect(after.me.autodraft).toBe(false);
    expect(after.onClock.name).toBe('Joey E2E');
  } finally {
    await cleanup(seed.leagueId, [joeyId, momId]);
  }
});
```

- [ ] **Step 5: Run it**

Run: `npm run e2e`
Expected: 1 passed (takes about 1–2 minutes: a production build, then a 30 s timeout inside the test). It uses the one Supabase project and cleans up its league and both test users. If it fails, open the trace: `npx playwright show-trace test-results/*/trace.zip`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json playwright.config.ts e2e .gitignore
git commit -m "test(draft): Playwright E2E of a two-phone live draft"
```

---

### Task 18: Docs

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: README**

Add a section to `README.md` (after the existing "How it works"/usage section):

```markdown
## Live drafts (v2)

A round can be drafted two ways (round admin → **Live draft** card):

- **Commissioner enters picks** — the v1 draft entry screen.
- **Live draft on everyone's phones** — pick a timer (off / 30 / 60 / 90 / 120 s), set the draft order, and press **Start draft**. Everyone opens the round's **draft room** (`/l/{slug}/r/{roundId}/draft`, also linked from the "Draft is live — join" banner). When a timer runs out, the server picks for that player: the first available team in their queue, else the lowest team number (projections arrive in SP3). Players can turn on **Auto-draft for me**. The commissioner can pause, resume, undo the last pick, and pick for whoever is on the clock.

Fallback: until the draft starts, a round can be switched back to commissioner entry.

### Checks

- `npx tsx --env-file=.env.local scripts/smoke-v2.ts` — real-database checks (racing picks, undo vs timeout, pause/resume, RLS on, anon key locked out). Run after applying a migration.
- `npm run e2e` — two-phone live draft in Playwright against a local production build. Needs `E2E_AUTH_SECRET` in `.env.local` (never set it on Vercel).
```

Add `supabase/migrations/0003_live_draft.sql` to the database-setup instructions next to `0001`/`0002` ("run each migration file in order in the SQL Editor").

- [ ] **Step 2: CLAUDE.md**

Under "Current status", add: `- v2 SP4 (live draft room) built: live/commissioner draft modes, atomic pick/undo/control SQL functions, Realtime doorbell + polling, E2E. Migration 0003 applied.` Keep the rest unchanged (SP1 updated the locked decisions).

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: live draft room, smoke script, and E2E"
```

---

### Task 19: Merge SP4 and rehearse on the live site

**Files:** none new.

- [ ] **Step 1: Final gates on the branch**

Run: `npm run typecheck && npm test && npm run build && npx tsx --env-file=.env.local scripts/smoke-v2.ts && npm run e2e`
Expected: all clean/green. Record the test count (baseline after SP1 + all SP4 tests).

- [ ] **Step 2: Whole-branch review**

Dispatch the whole-branch code review (superpowers:requesting-code-review) against `main`, with the spec §7 and this plan's Review Focus as the checklist. Fix wave for anything Important, re-run Step 1.

- [ ] **Step 3: PR and merge (only when Joey says so)**

Push the branch and open a PR titled `v2 SP4: live draft room` whose body lists: the three SQL functions and deviation 1, the 409 codes, the Realtime doorbell + polling, the E2E result, and the fallback (commissioner mode). Merge after Joey approves. Migration `0003` is already applied (Task 1 Step 10); nothing new is needed in Vercel env (SP1 added the public Supabase keys).

- [ ] **Step 4: Production check**

On `https://frc-fantasy-5181.vercel.app`, in a throwaway league: switch a round to **Live draft**, 30 s timer, start it, and draft from two real phones (one iPhone, one Android if possible), both themes. Confirm: the countdowns agree, a pick shows on the other phone within ~1 s, a timeout auto-picks, "Reconnecting…" appears in airplane mode and clears after. Delete the throwaway league afterwards.

- [ ] **Step 5: Hand off**

Report to Joey: merged, test count, smoke + E2E results, production check. The family mock draft (Oct 19–20, spec §10) uses this feature; SP3 (next plan) fills in projections.

---

## Self-review notes (plan author)

- **Spec coverage:** §7.1 data + phase + pause/resume (Tasks 1–3); §7.2 atomic pick/undo (Tasks 1, 3, 16); §7.3 every endpoint (Tasks 5, 7–11); §7.4 auto-pick, `advance`, timeouts (Tasks 2, 6, 8); §7.5 doorbell, polling, clock sync, rate limit (Tasks 4, 12, 14); §7.6 room UI, banners, commissioner menu, errors (Tasks 13–15); §6.3 pool endpoint/UI with stats as "New" (Tasks 5, 13); §8.1 RLS test + RPC lockdown (Tasks 1, 16); §8.2 `0003` (Task 1); §9 E2E + smoke (Tasks 16–17).
- **Review Focus pins:** 1 → Task 3 + Task 8 + Task 16; 2 → Task 6 + Task 10; 3 → Task 2 + Task 3 + Task 16; 4 → Task 8; 5 → Task 11 + Task 17.
- **Assumptions on SP1** (check before starting): `requireLeagueRole` / `requireLeagueView` signatures from the index contract; `LeaguePatch.visibility`; `Repo.createMember`; `createBrowserSupabase`; the test-login body/response shape (Task 17); that `seedLeague` returns `{ league, commissioner, user }`; and that `leagues.admin_token_hash` is nullable (smoke/E2E insert leagues without it).
