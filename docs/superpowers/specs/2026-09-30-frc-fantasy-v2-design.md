# FRC Fantasy v2 — Design Spec

- **Date:** 2026-09-30
- **Author:** Joey (FRC Team 5181), with Claude
- **Status:** Draft — design sections approved by Joey in brainstorming 2026-09-30; awaiting written-spec review
- **Extends:** `docs/superpowers/specs/2026-09-29-frc-fantasy-design.md` (the v1 spec). Everything in v1 still holds unless this spec says otherwise. Section references like "v1 §7.3" point at the v1 spec.
- **Target:** live for **Ramp Riot 2026 draft night (Fri Oct 23, 2026)**, all-in (no parallel v1 fallback deploy; `v1.0` git tag + Vercel instant rollback only).

---

## 1. Purpose

Take FRC Fantasy from a family prototype to a usable app for the **FRC community**: anyone in FRC can sign in, start a league, invite friends, draft live from their phones, and follow their teams all season.

### 1.1 Success criteria

1. A person who has never seen the app can land on `/`, understand what it is from the landing page, sign in with Google or Discord, create a league, and share an invite code — without help.
2. Ramp Riot 2026 draft night (Oct 23) runs as a **live draft on everyone's phones**, with the Habich family league migrated from v1 (all v1 picks and history intact).
3. Each signed-in user sees a personal **Me** dashboard: their teams playing now, their rank in every league, and their season stats.
4. A full-season league can draft from all FRC teams (optionally filtered by region) and scores every official event automatically.
5. The draft pool shows projected fantasy points, past results, and current OPR/rank so non-experts can draft sensibly.
6. All v1 tests stay green; the `2025parr` replay produces the same scores as v1.

### 1.2 Scope: four sub-projects, built in this order

| # | Sub-project | Section |
|---|---|---|
| 1 | **Accounts & leagues** — sign-in, profiles, landing page, Me/Leagues tabs, invite codes, roles, visibility, v1 league migration | §4 |
| 2 | **League formats** — event-by-event (TBA or manual rounds, follow-a-team auto-rounds) and full season; derived `event_scores` cache | §5 |
| 3 | **Pre-draft team info** — `team_stats` (projections, past results, OPR/rank) in the draft pool | §6 |
| 4 | **Live draft room** — realtime phone drafting, pick timer, auto-pick, queue | §7 |

Order rationale: the live draft needs accounts (whose phone is whose), uses projections for auto-pick, and must work for full-season pools — so it is built last, once, on the final data model.

### 1.3 Non-goals for v2

- Notifications (push, email, SMS). The draft room only flashes the tab title and vibrates (Android) while the page is open.
- Trades, waivers, free agents (**parked for v3**).
- Season awards / recaps, league chat, a public league browser.
- A big-screen / TV draft board (phones only).
- Email or password sign-in (would require a domain + mail provider).
- Name-only ("ghost") players. Every player has an account; v1 players are the only exception, and only until claimed (§4.7).
- Per-league-config projections (projections use default scoring, §6.1).
- Native apps, payments, ads.

---

## 2. Decisions locked in brainstorming (don't re-litigate)

| Topic | Decision |
|---|---|
| Audience | FRC community; open sign-up; free tiers; light abuse limits |
| Sign-in | Supabase Auth, **Google + Discord** OAuth only |
| Players | **Accounts required** for all players |
| App shell | Signed-out `/` = landing page. Signed-in = bottom tabs **Me** + **Leagues** |
| League visibility | Per league, commissioner chooses: `link` (anyone with the link can view; default) or `members` |
| Joining | Invite link + 6-char code, **instant** join; commissioner can remove members and reset the code |
| Formats | Two league types: **event-by-event** and **full season**. "Follow a team" and "manual event" are options within event-by-event, not formats |
| Follow-a-team | **Fully automatic** round creation (daily cron + on-visit sync); deleted auto-rounds never return |
| Manual events | Scored from a **final-results form** per team (no OPR) |
| Full season | Draft once; teams score at **every official event** that season; pool = all teams + optional district/state/country filter |
| Team info | Projected fantasy points (default scoring), past results, current OPR & rank. No nickname/rookie-year block |
| Live draft | Commissioner-set timer (off/30/60/90/120 s); auto-pick on timeout (queue → projection); "auto-draft me"; draft queue; pause/undo; commissioner can pick for anyone |
| Architecture | **Evolve v1 in place.** Server is the only database client (RLS on, no policies, service-role key server-only). Auth checks in API routes. Supabase Realtime **Broadcast as a data-free doorbell** + polling fallback |
| Caching | **Changed from v1:** `tba_cache` is no longer the only cache. A derived, rebuildable `event_scores` table caches scored events (§5.6) and `team_stats` holds projections (§6). Scores remain a pure function of TBA data + config + picks + adjustments + manual results |
| Name | Keep "FRC Fantasy" (team 610 runs a different app with the same name; accepted) |

---

## 3. Architecture overview

Same stack as v1 (v1 §9): Next.js App Router + TypeScript, Tailwind, Supabase Postgres, zod, Vitest, Vercel Hobby. Next.js caching stays disabled (`force-dynamic`, `no-store`).

**New pieces:**

| Piece | Purpose |
|---|---|
| `@supabase/ssr` | Cookie-based Supabase Auth sessions readable in server components, route handlers, and middleware (session refresh) |
| `lib/auth/session.ts` | `getUser()` (current user or null) and `requireUser()` (401) — the only place that reads the auth cookie |
| `lib/auth/roles.ts` | `requireLeagueRole(slug, role)` → `{ league, player }` or 401/403/404. Replaces `x-commissioner-key` checks in every admin route |
| `lib/scoring/manual.ts` | `scoreManualEvent(results, config)` → the same `EventScores` shape as `scoreEvent` |
| `lib/scores/eventScores.ts` | Read-through derived cache over `scoreEvent` (§5.6) |
| `lib/follow/sync.ts` | `syncFollowedEvents(league)` (§5.4) |
| `lib/stats/` | `team_stats` builder + projection math (§6) |
| `lib/draft/live.ts` | Pure live-draft logic: whose turn, deadline math, auto-pick choice (§7) |
| `lib/realtime/doorbell.ts` | Server-side Broadcast "ring" over Supabase's HTTP endpoint (§7.5) |
| `app/api/cron/daily/route.ts` | Vercel cron (once daily on Hobby), guarded by `CRON_SECRET`: follow-a-team sync + `team_stats` refresh |

**Unchanged:** the TBA client and its cache windows (v1 §7.3), the scoring engine (`scoreEvent`, v1 §7.9), snake order (`pickerFor`), adjustments, round status derivation (v1 §7.8, extended in §5.2), the `Repo` interface pattern (extended, with the in-memory repo used in tests).

**Trust boundaries:** the browser never talks to Postgres. The browser *does* talk to Supabase Auth (OAuth redirect) and Supabase Realtime (subscribe to a public Broadcast channel with the anon key). Broadcast messages carry no data (§7.5), so a public channel leaks nothing beyond "something changed in draft X".

---

## 4. Sub-project 1 — Accounts & leagues

### 4.1 Sign-in

- **Providers:** Google and Discord via Supabase Auth OAuth (PKCE). Configured in the Supabase dashboard; client IDs/secrets live in Supabase, not in our env.
- **Flow:** "Continue with Google/Discord" button → `supabase.auth.signInWithOAuth({ provider, options: { redirectTo: <origin>/auth/callback?next=<path> } })` from the browser client → provider → `GET /auth/callback` exchanges the code for a session (cookie set via `@supabase/ssr`) → first sign-in creates the profile (§4.2) → redirect to `next`.
- `next` must be a same-origin relative path starting with `/` and not `//`; anything else becomes `/`.
- **Session refresh:** Next.js middleware calls the `@supabase/ssr` refresh helper on every request except static assets.
- **Sign out:** `POST /auth/signout` → clears the session → redirect `/`.
- **Env vars:** add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public by design; the anon key can do nothing to our tables because RLS has no policies). `SUPABASE_SERVICE_ROLE_KEY` stays server-only. Remove `CREATE_LEAGUE_PASSCODE`.
- **Auth failure** (user cancels, provider error): callback redirects to `/?auth_error=1`, and the landing page shows "Sign-in didn't finish — try again."

### 4.2 Profiles

```sql
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  avatar_url    text,
  frc_team      integer check (frc_team between 1 and 99999),
  created_at    timestamptz not null default now()
);
```

- Created on first sign-in from provider metadata (`full_name` → `name` → `user_name`, trimmed, cut to 40 chars; fallback `"Player"`). `avatar_url` from provider metadata.
- `/me/settings`: edit display name and "My FRC team" (optional), sign out, **delete account**.
- **Delete account:** blocked while the user is the *only* commissioner of a league that has other members ("Make someone else commissioner first"). Otherwise: their `players` rows are **unlinked** (§4.3), leagues where they were the only member are deleted, then the auth user is deleted (profile cascades).

### 4.3 Membership = `players` rows

The v1 `players` table becomes the membership table, so every existing pick, adjustment and `draft_order` stays valid.

```sql
alter table players
  add column user_id    uuid references profiles(id) on delete set null,
  add column role       text not null default 'player' check (role in ('commissioner', 'player')),
  add column claimable  boolean not null default false;   -- true only for migrated v1 rows (§4.7)
create unique index players_league_user on players (league_id, user_id) where user_id is not null;
```

- **Joining** creates a row with `user_id` set and `name` = the user's display name. If that name collides (case-insensitive, v1 rule), append ` 2`, ` 3`, …. Players can rename themselves within a league (same uniqueness rule).
- **No name-only players:** the v1 "add player by name" endpoint is removed. Rows with `user_id is null` exist only as (a) claimable migrated v1 players or (b) **unlinked** former members.
- **Remove member / leave league / account deletion:** if the player has no picks, adjustments, or draft-order entries, delete the row. Otherwise **unlink**: set `user_id = null`, `claimable = false`, keep the name; history and standings stay intact, and the row shows as "Mom (left)". Unlinked rows cannot be claimed or re-linked.
- **Roles:** commissioners can promote/demote any member. A league must always have ≥ 1 commissioner with a linked account (except pre-claim migrated leagues, §4.7); the last commissioner can't leave, be demoted, or be removed.
- **Caps:** ≤ 30 players per league (counting unlinked rows); joining a full league → 409 "League is full".

### 4.4 League changes

```sql
alter table leagues
  add column invite_code  text unique,                       -- set for every row by the migration, then:
  add column visibility   text not null default 'link' check (visibility in ('link', 'members')),
  add column created_by   uuid references profiles(id) on delete set null,
  alter column admin_token_hash drop not null;               -- dropped entirely in migration 0004 (§8.2)
-- after backfill: alter table leagues alter column invite_code set not null;
```

- **Invite code:** 6 chars from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0/O/1/I/L), stored uppercase, matched case-insensitively. ~887M combinations; unknown codes return a uniform 404.
- **Create league** (`POST /api/leagues`, signed in): `{ name, format, visibility, …format options (§5) }` → creates the league, a random invite code, and the creator's `players` row with `role = 'commissioner'`. Cap: **5 leagues created per user** (`created_by` count) → 409 "You've reached the 5-league limit".
- **Delete league** (new, commissioner only): confirmation requires typing the league name. Cascades like v1.
- **Reset invite code** (commissioner): new random code; old links stop working.

### 4.5 Permissions

| Actor | Can |
|---|---|
| Signed out | Landing page; view `link` leagues and their rounds (read-only) |
| Signed in, not a member | Same, plus join with a code |
| Player (member) | View the league even if `members`-only; rename self in the league; leave; manage own draft queue & auto-draft; make live-draft picks on own turn (§7) |
| Commissioner | Everything a player can, plus all v1 admin actions, member management (promote/demote/remove), invite reset, visibility, league deletion, commissioner picks during live drafts |

- All admin endpoints keep their v1 paths (`/api/l/{slug}/admin/*`) and bodies, but authenticate with the **session cookie** + `requireLeagueRole(slug, 'commissioner')` instead of `x-commissioner-key`: 401 signed out, 403 not a commissioner, 404 unknown league. The v1 "`{id}` must belong to `{slug}`" check stays.
- Player endpoints (`/api/l/{slug}/me/*`, `/api/l/{slug}/rounds/{id}/draft/*`) use `requireLeagueRole(slug, 'player')` (commissioners pass too).
- **Members-only leagues:** league and round pages render a "Private league — ask the commissioner for an invite code" card for non-members (no data), instead of 404, so a shared link explains itself.
- The admin UI keeps its client-rendered shells (v1 §4) to limit churn; `AdminGate` now calls `GET /api/l/{slug}/admin/verify` with cookies and shows "You're not a commissioner of this league" on 403. The fragment/`localStorage` token code is deleted (except the one-time claim flow, §4.7).

### 4.6 Screens

**App shell (signed in):** a fixed bottom tab bar, **Me** | **Leagues**, on every signed-in page; league pages keep their existing top `TabBar`. Avatar/settings gear in the Me header. Signed-out pages have no bottom bar, just a "Sign in" button in the header.

**`/` signed out: landing page** (dark-first, bumper plates, scoreboard style from `design-system/frc-fantasy/`):

| Block | Content |
|---|---|
| Hero | Display headline (working copy: "Draft FRC teams. Watch every match. Roast your friends."), one-line explainer, **Continue with Google** / **Continue with Discord**, and a "Have an invite code?" input that goes to `/join/{CODE}` |
| Sample scoreboard | Static demo leaderboard (4 players, bumper plates) with one expanded breakdown (e.g. "341: +10 rank · +8 captain · +15 winner") — explains scoring by showing it |
| How it works | 3 scoreboard cards: **Draft** (snake draft live from your phone) → **Watch** (points from real results via The Blue Alliance) → **Win** (season standings) |
| Two ways to play | Cards for Event-by-event and Full season |
| Coming up | Next 4 upcoming events from TBA `/events/{year}/simple` (`start_date ≥ today`, sorted; cache window 10 min), each with "Start a league for this event" → `/leagues/new?event={key}` (sign-in first if needed) |
| Footer | "Made by students on FRC Team 5181 · Data from The Blue Alliance" |

If TBA is unreachable, the Coming-up block is omitted (never an error page).

**`/` signed in: Me tab**

- **Live now / Up next** card: for each of the user's picks in rounds that are Live (or Upcoming within 7 days), show the team's bumper plate and its next unplayed match from cached TBA matches: "Q14 · up next" / "Q14 · in 2 matches" (N = unplayed matches ordered before it) / "Eliminated" / "Done". Hidden if nothing is live or upcoming.
- **My leagues:** each league with format badge, my rank and total in the current season standings, a live dot if any round is Live. Tap → `/l/{slug}`.
- **My season** (calendar year): total points across all leagues, best pick (the single team-in-a-round with the most points for me, e.g. "341 at Ramp Riot · +62"), average finish (mean of my rank across finalized rounds; "—" if none).
- Empty state (no leagues): "Create a league" and "Join with a code" buttons.

**`/leagues`: Leagues tab** — list of my leagues (same rows as Me), **Create league** button, and a join-code input.

**`/leagues/new`: create league** — name, format (event-by-event / full season), visibility; format-specific options (§5.3, §5.5). Prefills when opened with `?event={key}` (event-by-event, with that event as the first round).

**`/join/{code}`** — signed out: league name + sign-in buttons (`next` returns here). Signed in: league name, commissioner, member count, and **Join**. If the league has claimable players (§4.7): "Are you one of these?" list + "No, I'm new here". Already a member → redirect to `/l/{slug}`. Full → "League is full". Unknown code → "That invite code doesn't work — check with your commissioner."

**`/l/{slug}/admin` additions:** a **Members** section — invite code with Copy link / Reset, visibility toggle, member list with role toggle and Remove (§4.3 rules), and Delete league (danger zone).

**`/me/settings`** — §4.2.

### 4.7 Migrating v1 leagues

Migration `0002` (additive) runs on the live database:
- Existing `players` rows: `user_id = null`, `role = 'player'`, `claimable = true`.
- Existing `leagues` rows: generated `invite_code`, `visibility = 'link'`, `created_by = null`.
- `admin_token_hash` is kept (nullable).

**Claiming commissioner:** a league with no linked commissioner still accepts its v1 admin link. Opening `/l/{slug}/admin#k=…` while signed in shows **"Claim this league as commissioner"**, with "Which player are you?" (claimable names + "I'm not playing"). `POST /api/l/{slug}/claim` with the token in `x-commissioner-key` verifies it (v1 constant-time check), then links the chosen claimable row (or creates a new non-playing row) with `role = 'commissioner'`, and sets `admin_token_hash = null` so the link is dead. Signed out, the page asks you to sign in first (the fragment survives the OAuth round trip by being stored in `sessionStorage` before redirect).

**Claiming players:** family members open the invite link, sign in, and pick their old name under "Are you one of these?". This links that row (`user_id`, `claimable = false`); all v1 picks and adjustments come with it. The commissioner can **unlink** a wrong claim from the Members section (the row becomes claimable again, only in this case).

**Leftovers:** the demo league and `testleague-o3alja` are claimed or deleted before migration `0004` drops `admin_token_hash` and `scripts/rotate-admin-token.ts`.

### 4.8 Guardrails

- 5 created leagues per user; 30 players per league.
- Display and player names: 1–40 chars, trimmed, no control characters. No profanity filter (commissioners can remove members).
- Unknown invite codes and non-member access to members-only data return uniform responses (no existence leaks beyond the league name shown on a valid invite).
- Me-tab data loads per league in parallel; one failing league shows "Couldn't load" on its row, not a page error.

---

## 5. Sub-project 2 — League formats

### 5.1 League format

```sql
alter table leagues
  add column format             text not null default 'event' check (format in ('event', 'season')),
  add column follows_synced_at  timestamptz;
```

`format` is chosen at creation and **cannot change** afterwards. v1 leagues migrate as `event`.

| | Event-by-event (`event`) | Full season (`season`) |
|---|---|---|
| Rounds | One per event: `tba` or `manual` kind; added by hand or by follow-a-team | One `season` round per FRC season year |
| Draft | Per round (v1) | Once per season round |
| Standings | Sum of rounds (v1 `seasonStandings`) | Same function over season rounds |

### 5.2 Round changes

```sql
alter table rounds
  add column kind         text not null default 'tba' check (kind in ('tba', 'manual', 'season')),
  alter column event_key  drop not null,
  add column season_year  integer check (season_year between 1992 and 2100),
  add column pool_filter  jsonb,                  -- season rounds only (§5.5)
  add column auto_added   boolean not null default false,
  add constraint rounds_kind_event_key check ((kind = 'tba') = (event_key is not null)),
  add constraint rounds_kind_season    check ((kind = 'season') = (season_year is not null));
alter table rounds drop constraint rounds_roster_size_check;
alter table rounds add constraint rounds_roster_size_check check (roster_size between 1 and 15);
```

- `event_name`, `start_date`, `end_date`, `timezone` stay required for every kind (manual: typed by the commissioner; season: §5.5).
- Roster size: 1–10 for `tba`/`manual` (app rule, as v1), 1–15 for `season`.
- The v1 unique `(league_id, event_key)` still applies; Postgres treats NULLs as distinct, so manual and season rounds don't collide.
- **Round status** (v1 §7.8) is unchanged in logic and works for all kinds because it only uses dates, picks, and `finalized_at`.
- Admin UI: event leagues get **Add round → TBA event | Manual event**; season leagues get no "Add round" (§5.5).

### 5.3 Manual rounds

- **Create:** `POST /api/l/{slug}/admin/rounds { kind: 'manual', name, startDate, endDate }` (name 1–80 chars; `endDate ≥ startDate`; timezone defaults to `America/New_York`).
- **Pool:** only `round_extra_teams` (the existing "add team number" UI). The v1 `P × R ≤ T` check applies.
- **Results** are entered after (or during) the event in a new **Results** tab of the round admin: one row per pool team, drafted teams listed first with a "Show all teams" toggle.

```sql
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
```

- `PUT /api/l/{slug}/admin/rounds/{id}/results/{teamKey}` upserts one row (team must be in the pool; 400 otherwise). `DELETE` clears it. Only allowed for `manual` rounds (409 otherwise).
- Awards picker lists common TBA award types by name (Impact, Engineering Inspiration, Rookie All-Star, Winner/Finalist excluded as in the config, etc.) plus "Other award" (scored with `awards.default`).
- **`scoreManualEvent(results, config): EventScores`** (`lib/scoring/manual.ts`, pure) emits the same `CategoryId`s and line labels as `scoreEvent` for: `qualRecord`, `rankingPoints`, `rank`, `alliance`, `playoffWins`, `eventResult`, `awards`. It never emits `oprBonus`. `qualsComplete = results.length > 0`; `rpMethod = 'manual'` (new union member). Unknown (`null`) RP or rank emits no line.
- **Equivalence test:** entering `2025parr`'s real results into `manual_results` must produce, for every team, `scoreEvent` totals minus that team's OPR line (`scoreEvent` itself is unchanged).
- Manual rounds are not cached in `event_scores` (scoring them is cheap; there's no TBA input).

### 5.4 Follow-a-team (event leagues)

```sql
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
```

- League settings: "Follow teams" — up to **3** team numbers (event leagues only). v1's `home_team_number` setting is superseded (removed from the UI; column dropped in migration `0004`). Following is opt-in: the migration does not create follows.
- **`syncFollowedEvents(league, now)`** (`lib/follow/sync.ts`):
  1. For each followed team, `getTba('/team/frc{n}/events/{year}/simple')` for the current calendar year (10 min window).
  2. Keep events with `event_type` not in {100 preseason, −1 unlabeled} (offseason `99` is **included**), `end_date ≥ today − 1 day`, not already a round in the league, and not in `league_skipped_events`.
  3. Create each as a `tba` round with `auto_added = true`, TBA name/dates/timezone, `scoring` = league default, `roster_size` and `draft_order` copied from the league's most recently created round (order filtered to players whose accounts are still linked; roster size default 4 if no round exists).
  4. Insert with `on conflict (league_id, event_key) do nothing`, so concurrent syncs are harmless.
  5. Set `leagues.follows_synced_at = now`.
- **Triggers:**
  - **Daily cron** `GET /api/cron/daily` (Vercel cron, `vercel.json` schedule `0 10 * * *` UTC; requires `Authorization: Bearer $CRON_SECRET`, else 401) syncs every league with follows.
  - **On visit:** loading `/l/{slug}` or the admin dashboard runs the sync via Next.js `after()` (after the response is sent) when `follows_synced_at` is null or older than 10 minutes. New rounds appear on the next refresh; auto-refresh (v1 PR #2) picks them up.
- **Deleting an auto-added round** also inserts `league_skipped_events`, so it never comes back. Deleting a manually added round does not.
- A TBA failure during sync is logged and ignored (no rounds created, `follows_synced_at` not updated).
- Auto-added rounds show a small "Auto-added · following 5181" note in the admin round list.

### 5.5 Full-season leagues

- **Create:** format `season` + `seasonYear` (current year, or next year from October on) + pool filter. Creation also creates the league's single season round (`kind = 'season'`, `event_name = "{year} Season"`, `roster_size` default 8).
- **Next season:** a season league's admin shows "Start {year + 1} season" once the latest season round is Final; it creates a new season round (draft order copied). League standings span all season rounds (v1 `seasonStandings`).
- **Dates:** `start_date`/`end_date` = the earliest start and latest end among that year's official events (TBA `/events/{year}/simple`), refreshed by the daily cron. Before TBA publishes the calendar: Jan 1 – Dec 31. `timezone = 'America/New_York'`.
- **Pool filter** (`pool_filter` jsonb, zod-validated), editable only while the round has no picks:
  - `{ "type": "all" }` (default) — TBA `/teams/{year}/{page}/simple`, pages 0.. until an empty page (24 h window per page).
  - `{ "type": "district", "key": "2027fma" }` — `/district/{key}/teams/simple`. The picker lists `/districts/{year}`.
  - `{ "type": "state", "country": "USA", "state": "Pennsylvania" }` — all teams filtered on `country` + `state_prov`.
  - `{ "type": "country", "country": "Canada" }`.
- **Empty pool:** if TBA hasn't published the year's team list, the draft can't start: "TBA hasn't published {year} teams yet — usually by January." v1's `P × R ≤ T` check applies.
- **Official events:** `event_type ∈ {0 Regional, 1 District, 2 District Championship, 3 Championship Division, 4 Championship Finals, 5 District Championship Division}`. Offseason (99) and preseason (100) never count.
- **Scoring:** for each drafted team, list its official events that year (`/team/{key}/events/{year}/simple`), score each via `getEventScores` (§5.6) with the season round's `scoring`, and sum. `TeamScore.lines` are grouped per event. Team-targeted and player-targeted adjustments work as v1.
- **Cache windows:** each event's TBA paths use `cacheWindowFor` computed from *that event's* dates (not the season round's), so finished events drop to the 24 h/10 min windows.
- **Round page (season):** per player, each team shows a season total, expandable to per-event subtotals ("Week 1 · Hatboro-Horsham · +41"), each expandable to v1-style lines. Upcoming events for the team are listed as "Next: {event} · {date}".
- **Status:** v1 rules with the season's dates: Live once the first official event is within a day, Awaiting final after the last one ends; only the commissioner finalizes.

### 5.6 Derived cache: `event_scores`

**Why:** a full-season league with 10 players × 10 teams touches ~60 events; re-scoring from raw TBA JSON on every page view would pull 15+ MB from Postgres per request. The Me tab across several leagues has the same problem.

```sql
alter table tba_cache add column body_hash text;   -- sha256 of the stored body; null when body is null

create table event_scores (
  event_key     text not null,
  config_hash   text not null,   -- sha256 of canonical (sorted-key) JSON of the ScoringConfig
  source_stamp  text not null,   -- sha256 of the input paths' body_hash values, in fixed path order
  scores        jsonb not null,  -- serialized EventScores: { teams: { [teamKey]: { total, lines } }, qualsComplete, rpMethod }
  computed_at   timestamptz not null,
  primary key (event_key, config_hash)
);
```

**`getEventScores(eventKey, config, windowMs)`** (`lib/scores/eventScores.ts`):
1. Input paths = the fixed list `scoreEvent` needs (event teams, matches, rankings, alliances, awards, oprs — exactly the paths v1's `loadEventData` reads).
2. Read those paths' `tba_cache` **metadata only** (`path, fetched_at, body_hash, last_error_at`; no bodies).
3. If every path is within `windowMs` and a row exists in `event_scores` for `(eventKey, config_hash)` whose `source_stamp` matches → return it (no body reads).
4. Otherwise refresh through `getTba` as v1 (304s keep `body_hash`, so the stamp is unchanged and step 5 is skipped), recompute the stamp, and if it differs from the stored one: load bodies, run `scoreEvent`, and upsert the row.
5. Staleness (`stale`, `fetchedAt`) is reported exactly as v1 does, from the TBA metadata.

**Rules:**
- The cache is **derived and rebuildable**: `scripts/rebuild-event-scores.ts` truncates it and nothing breaks. It is never edited by hand or by the app except through `getEventScores`.
- Round pages (v1 `tba` rounds), season rounds, the Me tab, and `team_stats` (§6) all read scores through `getEventScores`.
- The replay test asserts that `2025parr` round scores through `getEventScores` equal v1's direct `scoreEvent` output.
- CLAUDE.md's locked caching decision is updated to: "`tba_cache` is the only cache of *TBA data*; `event_scores` and `team_stats` are derived, rebuildable caches of *computed* values."

---

## 6. Sub-project 3 — Pre-draft team info

### 6.1 `team_stats` (derived, rebuildable)

```sql
create table team_stats (
  team_key          text not null check (team_key ~ '^frc[1-9][0-9]{0,4}[A-Z]?$'),
  season            integer not null,
  events_played     integer not null,          -- events with ≥ 1 qual match for this team
  total_points      integer not null,          -- fantasy points summed over those events, DEFAULT_SCORING
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
```

- **Events counted:** every event in that season except preseason (`100`), including offseason (`99`) when TBA has match data. Events with no qual matches for the team are skipped.
- **Points** always use `DEFAULT_SCORING` (`lib/scoring/config.ts`), via `getEventScores` (§5.6), so `event_scores` rows for the default config double as the stats source.
- **Projection** (`lib/stats/projection.ts`, pure), for a draft in season `Y`:
  `proj = (2 × total_points[Y] + total_points[Y−1]) / (2 × events_played[Y] + events_played[Y−1])`, rounded to 1 decimal. Missing seasons count as 0/0. If the denominator is 0 → `null`, shown as **"New"**.
- **Latest OPR / rank:** from the team's most recent event (by `end_date`) in season `Y` with data; falls back to `Y−1`.
- **Best finish:** best of winner > finalist > captain > picked across the season (from `eventResult` and `alliance` lines).

### 6.2 Building it

- **Past seasons (immutable):** `scripts/build-team-stats.ts <season>` runs locally with the service key. It walks `/events/{season}/simple`, loads each event through `getEventScores` + `loadEventData`, and upserts every team's row. It is resumable (skips events already reflected, tracked by `event_scores` presence) and throttled to ~5 TBA requests/s. Run for **2025 and 2026** before Ramp Riot (Ramp Riot projections = 2026 ×2 + 2025 ×1).
- **Current season:** the daily cron (§5.4) re-scores events of the current season with any day in `[today − 8, today]`, then recomputes `team_stats` rows for every team at those events. Each run stops at 50 s and continues on the next run.
- Teams with no row for either season show "New". Nothing is computed on the fly during page loads.

### 6.3 Draft pool UI

Used by the commissioner draft entry (v1), the live draft room (§7), and the round setup pool view.

- **Pool endpoint:** `GET /api/l/{slug}/rounds/{id}/pool` (anyone who can view the league) → `[{ teamKey, nickname, proj, record: [w, l, t], bestFinish, opr, rank, available }]`. For season pools (up to ~3,500 teams) the payload is ~350 KB before gzip; acceptable, fetched once per draft session and then patched by draft-state updates.
- **Row:** bumper plate · nickname · **Proj** · W-L-T · best finish badge · OPR / rank. "New" teams show a "New" chip instead of Proj.
- **Sort:** Proj (default, desc; "New" last), OPR, team number. **Search** by number or nickname (all pools; required for season pools). **Filter:** "Available only" (default on).
- **Team sheet** (tap a row): per-event history from `team_stats.events` for Y and Y−1 — event, rank, finish, fantasy points — plus awards.
- Stats are labelled "Proj. uses standard scoring" in a footnote, since leagues can customize scoring.

---

## 7. Sub-project 4 — Live draft room

### 7.1 Data

```sql
alter table rounds
  add column draft_mode           text not null default 'commissioner' check (draft_mode in ('commissioner', 'live')),
  add column pick_seconds         integer check (pick_seconds in (30, 60, 90, 120)),   -- null = no timer
  add column draft_started_at     timestamptz,
  add column draft_paused_at      timestamptz,          -- non-null = paused
  add column paused_remaining_ms  integer,              -- remaining time when paused (timer only)
  add column pick_deadline        timestamptz;          -- current pick's deadline; null if no timer, paused, not started, or done

create table draft_queue (
  round_id   uuid not null references rounds(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  team_key   text not null check (team_key ~ '^frc[1-9][0-9]{0,4}[A-Z]?$'),
  position   integer not null check (position >= 0),
  primary key (round_id, player_id, team_key)
);

create table draft_prefs (
  round_id   uuid not null references rounds(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  autodraft  boolean not null default false,
  primary key (round_id, player_id)
);
```

**Draft phase** (derived, `lib/draft/live.ts`): `setup` (not started) → `live` ⇄ `paused` → `done` (`picks = P × R`). Commissioner-mode rounds behave exactly as v1. Draft order, roster size, and pool filter lock once `draft_started_at` is set (v1 already locks them once any pick exists).

### 7.2 Atomic pick writes

supabase-js can't run multi-statement transactions, so every live-draft pick goes through one Postgres function called via RPC:

```
draft_make_pick(p_round_id, p_pick_number, p_player_id, p_team_key, p_require_due boolean) returns boolean
```

In one transaction it: locks the round row (`for update`); checks the phase is `live`; checks `count(picks) = p_pick_number`; if `p_require_due`, checks `now() >= pick_deadline` (database clock); inserts the pick (the v1 unique constraints on `(round_id, pick_number)` and `(round_id, team_key)` still guard); sets `pick_deadline = now() + pick_seconds` (or null when the timer is off or the draft is now done). It returns `false` (no-op) instead of raising when a check fails, so racing callers get a clean "someone beat you" answer. The server still validates the picker (`pickerFor`) and pool membership before calling it.

### 7.3 Endpoints

Player role (§4.5) unless marked *commissioner*. All bodies zod-validated.

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/api/l/{slug}/rounds/{id}/draft/state` | — | `{ phase, pickNumber, onClock: { playerId, name }, deadline, serverNow, pickSeconds, order, rosterSize, picks, me: { playerId, queue, autodraft } }` (viewers of `link` leagues get it without `me`) |
| POST | `…/draft/pick` | `{ expectedPickNumber, teamKey }` | 201; 409 `not_your_turn` / `stale` / `taken` / `not_live`; 400 not in pool |
| POST | `…/draft/tick` | `{ expectedPickNumber }` | 200 `{ picked: boolean }` — auto-picks for the on-clock player if the deadline has passed |
| PUT | `…/draft/queue` | `{ teamKeys: string[] }` (≤ 100, all in pool, no dupes) | 200 — replaces my whole queue |
| PUT | `…/draft/autodraft` | `{ on: boolean }` | 200 |
| PATCH | `/api/l/{slug}/admin/rounds/{id}` (*commissioner*) | adds `{ draftMode?, pickSeconds? }` | `draftMode` only before start; `pickSeconds` before start or while paused |
| POST | `/api/l/{slug}/admin/rounds/{id}/draft/start` (*commissioner*) | — | 200; 409 if order empty, `P × R > T`, not live mode, or already started |
| POST | `…/admin/rounds/{id}/draft/pause` · `/resume` (*commissioner*) | — | 200 |

- **Commissioner picks:** the v1 `POST …/admin/rounds/{id}/picks` endpoint (always the current snake picker) keeps working in live mode ("Pick for Mom"), going through `draft_make_pick`.
- **Undo** (v1 `DELETE` last pick): in live mode it also resets `pick_deadline = now() + pick_seconds`.
- Every successful mutation above **rings the doorbell** (§7.5).

### 7.4 Auto-pick

`chooseAutoPick(queue, available, proj)` (pure): the first team in the player's queue that is still available; otherwise the available team with the highest `proj`; ties and "New" teams go by lowest team number, after all projected teams.

Auto-picks happen when:
1. **Timeout:** a client calls `tick` after its corrected clock passes `deadline + 500 ms`. The server calls `draft_make_pick(…, p_require_due = true)`. Clients retry `tick` every 2 s while the deadline is overdue.
2. **Auto-draft:** after any successful pick, while the phase is `live` and the next on-clock player has `autodraft = true`, the server immediately auto-picks for them (bounded by the remaining picks).

If nobody has the draft open when a deadline passes, nothing happens until someone opens it; then `tick` catches up one pick at a time (each auto-pick sets a fresh deadline).

### 7.5 Realtime doorbell

- **Ring (server):** `ring(roundId)` POSTs to Supabase Realtime's HTTP broadcast endpoint (`{SUPABASE_URL}/realtime/v1/api/broadcast`, service key) with topic `draft:{roundId}`, event `changed`, **empty payload**. Failures are logged and ignored (polling covers them).
- **Listen (browser):** the draft page subscribes with the anon key: `channel('draft:{roundId}').on('broadcast', { event: 'changed' }, refetch)`. Refetches are debounced 250 ms.
- **Polling fallback:** every 3 s while the channel isn't `SUBSCRIBED`, every 15 s while it is, and immediately when the tab becomes visible again.
- **Clock sync:** each state response carries `serverNow`; the client keeps `offset = serverNow − (receivedAt − rtt/2)` and renders `remaining = deadline − (Date.now() + offset)`.
- Free-tier headroom: Realtime allows far more concurrent connections than a 30-player league needs; the doorbell adds one small message per pick.

### 7.6 Draft room UI — `/l/{slug}/r/{roundId}/draft`

- **Who:** members interact; non-members of `link` leagues watch read-only; members-only leagues show the private card (§4.5). Signed-in members see a "Draft is live — join" banner on the league and round pages while the phase is `live` or `paused`.
- **Sticky banner:** "On the clock: Mom · 0:42" (timer turns red under 10 s) / "You're up in 2 picks" / "Paused by commissioner" / "Draft complete". Menu: **Auto-draft for me** toggle; commissioners also get Pause/Resume, Undo last pick, Pick for {name}.
- **Your turn:** the tab title flashes "Your pick!" and `navigator.vibrate(200)` fires once (no-op on iOS).
- **Tabs:** **Pool** (§6.3, with a Draft button enabled only on your turn → confirm sheet "Draft 341 · Proj 38.2?") · **Queue** (my queue with up/down and remove, "Add to queue" from Pool rows; taken teams disappear automatically) · **Board** (pick grid: rounds × players, newest pick highlighted) · **Rosters**.
- **Errors:** 409 `taken` → "341 was just taken — pick again"; `stale`/`not_your_turn` → silent refetch; network loss → "Reconnecting…" banner while the local countdown continues; the server stays authoritative.
- **Season drafts:** same room; search is prominent; "Timer off" makes a slow draft that can run for days.
- Commissioner-mode rounds keep the v1 draft entry screen unchanged.
