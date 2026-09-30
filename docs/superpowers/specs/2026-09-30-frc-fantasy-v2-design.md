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
