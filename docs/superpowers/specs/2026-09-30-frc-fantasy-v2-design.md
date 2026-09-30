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
