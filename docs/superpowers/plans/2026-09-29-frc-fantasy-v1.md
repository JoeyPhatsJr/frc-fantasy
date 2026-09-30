# FRC Fantasy v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 FRC Fantasy web app (commissioner-entered snake drafts, scores computed live from The Blue Alliance, public leaderboards) in time for Ramp Riot 2026 on Oct 24, 2026.

**Architecture:** A pure, synchronous scoring engine (`lib/scoring/`) turns TBA event data + a round's scoring config + picks + adjustments into scores; nothing is ever stored as a score. A small TBA client caches raw TBA responses in one Postgres table (`tba_cache`). All database access goes through a `Repo` interface so route handlers can be tested against an in-memory fake. Public pages are server components; admin pages are client-rendered shells that send the commissioner token in a header.

**Tech Stack:** Next.js 16 (App Router, TypeScript strict), React 19, Tailwind CSS 4, Supabase Postgres (`@supabase/supabase-js` 2), zod 4, Vitest 5, tsx (for scripts), Vercel Hobby.

**Spec:** `docs/superpowers/specs/2026-09-29-frc-fantasy-design.md` (executors read both; section numbers like §7.3 refer to the spec).

## Plan files

This plan is split into three parts so each stays readable. Do them in order.

| Part | File | Tasks | Produces |
|---|---|---|---|
| 1 | `2026-09-29-frc-fantasy-v1-part-1-engine.md` | 1–11 | Scaffolded project + fully tested scoring engine + `2025parr` fixture replay |
| 2 | `2026-09-29-frc-fantasy-v1-part-2-data-api.md` | 12–21 | Database schema, TBA cache client, commissioner auth, every API endpoint |
| 3 | `2026-09-29-frc-fantasy-v1-part-3-ui.md` | 22–28 | Public pages, admin pages, README, deploy, replay dry run |

Timeline mapping (spec §11): Part 1 = Sep 30 – Oct 6. Part 2 + Tasks 22–27 = Oct 7 – Oct 13. Task 28 = Oct 14 – Oct 18. Priority 2 stretch items are **not** in this plan; they get their own plan only if everything here is done by Oct 19.

## Global Constraints

- **The project path contains a space** (`~/Claude/FRC Fantasy`). Quote every path in shell commands. Run all commands from the repo root.
- The repo root **is** the app (there is no `frc-fantasy/` subfolder). The npm package name is `frc-fantasy`.
- TypeScript `strict: true`. Import alias `@/` = repo root.
- Every page under `app/l/` and every route handler under `app/api/` exports `export const dynamic = 'force-dynamic'`. Cache Components stays disabled. Every `fetch` to TBA passes `cache: 'no-store'`. The Supabase client uses a `no-store` fetch. `tba_cache` is the only cache.
- Pages and route handlers that call TBA export `export const maxDuration = 30`.
- **Scores are computed, never stored.** No table or column may hold a score.
- Secrets are server-only env vars: `TBA_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CREATE_LEAGUE_PASSCODE`. Never prefix them with `NEXT_PUBLIC_`. Never commit `.env.local`.
- RLS is enabled on every table with no policies. The Supabase anon key is not used.
- Team keys match `^frc[1-9][0-9]{0,4}[A-Z]?$` everywhere. Event keys match `^[0-9]{4}[a-z0-9]+$`.
- All config point values are integers in `[-1000, 1000]`.
- Admin auth: `x-commissioner-key` header, compared as `sha256(header) == leagues.admin_token_hash` in constant time. Mismatch → HTTP 403 with no detail.
- 409 messages, copied verbatim: `That team was just taken` · `Draft changed in another tab — refresh` · `There's already a player with that name`.
- UI: usable at 360px width, no horizontal scrolling, tap targets ≥ 44px (`min-h-11` in Tailwind).
- TBA fetch timeout 5 s. Forced refresh ignored if the cache row is under 15 s old.
- Commit after every task. End every commit message with: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- TDD: write the failing test, watch it fail, implement, watch it pass, commit.
- Priority 2 features (5181 events helper, "the ones that got away", dark mode, drag-to-reorder) are out of scope for this plan.

## Deviations from the spec (flagged, per CLAUDE.md "raise it; don't silently diverge")

Joey should glance at these when reviewing. Each is small and is the plan's recommendation.

1. **`scoreRound` takes `players: Player[]` instead of `playerIds: string[]`** (§7.9). Reason: §3.6 requires ties to be ordered alphabetically by player name, so the function needs names.
2. **A player-targeted adjustment counts even if that player is not in the round's draft order.** §3.2 says non-participants earn 0, but §3.7 says an adjustment "applies directly to that player". The plan scores the adjustment (the player appears on that round's leaderboard with only the adjustment).
3. **Rank-tier points require `matches_played > 0`.** If TBA posts a rankings table before any match is played, nobody gets seeding points for an alphabetical placeholder rank.
4. **No ESLint.** Next.js 16 removed `next lint`; `tsc --noEmit` + Vitest are the quality gates. Not in the spec either way.
5. **Hand-verified fixture numbers are filled in during Task 11**, because they can only come from the real `2025parr` download, which needs Joey's TBA key. Task 11 gives the exact procedure. This is the one place the plan cannot pre-write expected values.
6. **"Add round" creates the round first, then shows its name and dates** (§5.4 says "shows event name/dates for confirmation"). The API table in §9.3 has no look-up-only endpoint, so the dashboard adds the round and shows a notice with the event name and dates plus a one-tap Delete. Adding a preview endpoint would be a small v1.1 change if the family finds this confusing.
7. **The rounds unique constraint is named** `rounds_league_event_key` in the migration (the spec's SQL leaves it unnamed) so the API can map it to "That event is already in this league".

## Review Focus

Inputs the spec implies but doesn't test, most likely to bite first. Each has a pinned test in the named task.

1. **Rankings posted before any match is played** (every team `matches_played: 0`) → nobody earns rank-tier points. *Test in Task 5.*
2. **Commissioner types a team as `frc341`, ` 341b `, `0341`, or junk like `34a1`** → the first three become `frc341` / `frc341B` / `frc341`; junk is rejected with a readable message. *Test in Task 3.*
3. **A URL with a non-UUID id** (`/l/x/r/not-a-uuid`, or the same in an API path) → 404, not a Postgres error and a 500. *Test in Task 15.*
4. **TBA gives a missing or unknown timezone string** → status and cache window fall back to `America/New_York` instead of throwing. *Test in Task 10.*
5. **Adjustment for a player who isn't in the round's draft order** → it still shows on the round leaderboard and counts in season standings. *Test in Task 9.*

## File Structure

```
app/
  layout.tsx                          root layout
  globals.css                         Tailwind entry
  page.tsx                            home + create-league form (Task 25)
  l/[slug]/page.tsx                   public league page (Task 24)
  l/[slug]/error.tsx                  friendly "database is asleep" page (Task 24)
  l/[slug]/not-found.tsx              (Task 24)
  l/[slug]/r/[roundId]/page.tsx       public round page (Task 23)
  l/[slug]/admin/page.tsx             commissioner dashboard (Task 26)
  l/[slug]/admin/r/[roundId]/page.tsx round admin (Task 27)
  api/leagues/route.ts                POST create league (Task 16)
  api/l/[slug]/admin/verify/route.ts  (Task 16)
  api/l/[slug]/admin/state/route.ts   (Task 16)
  api/l/[slug]/admin/league/route.ts  (Task 16)
  api/l/[slug]/admin/players/route.ts                 (Task 17)
  api/l/[slug]/admin/players/[id]/route.ts            (Task 17)
  api/l/[slug]/admin/rounds/route.ts                  (Task 18)
  api/l/[slug]/admin/rounds/[id]/route.ts             (Task 18)
  api/l/[slug]/admin/rounds/[id]/teams/route.ts       (Task 18)
  api/l/[slug]/admin/rounds/[id]/teams/[teamKey]/route.ts (Task 18)
  api/l/[slug]/admin/rounds/[id]/picks/route.ts       (Task 19)
  api/l/[slug]/admin/rounds/[id]/picks/[pickNumber]/route.ts (Task 19)
  api/l/[slug]/admin/rounds/[id]/adjustments/route.ts (Task 20)
  api/l/[slug]/admin/rounds/[id]/adjustments/[adjId]/route.ts (Task 20)
  api/l/[slug]/admin/rounds/[id]/refresh/route.ts     (Task 20)
components/
  Leaderboard.tsx  StatusBadge.tsx  Freshness.tsx  AutoRefresh.tsx
  RosterList.tsx  DraftBoard.tsx  AdjustmentList.tsx          (Tasks 23–24)
  admin/useAdmin.ts  admin/AdminGate.tsx  admin/ScoringForm.tsx (Tasks 26–27)
lib/
  teams.ts                 team-key parsing, labels, pool merging (Task 3)
  tba/types.ts             TBA response types, only the fields we use (Task 4)
  tba/client.ts            getTba + cache logic (Task 13)
  tba/event.ts             loadEventData: the six per-event calls (Task 13)
  scoring/config.ts        ScoringConfig zod schema + defaults (Task 2)
  scoring/types.ts         Line, TeamScore, Pick, Adjustment, ... (Task 4)
  scoring/matches.ts       hasResult, winnerOf, creditedTeams, qualsComplete (Task 4)
  scoring/quals.ts         qual records, RP extraction, rank tiers (Task 5)
  scoring/playoffs.ts      alliance positions, playoff wins, winner/finalist (Task 6)
  scoring/bonus.ts         awards, OPR bonus (Task 7)
  scoring/engine.ts        scoreEvent (Task 8)
  scoring/round.ts         pickerFor, scoreRound, seasonStandings (Task 9)
  rounds/status.ts         roundStatus, cacheWindowFor (Task 10)
  rounds/pool.ts           loadPool (Task 18)
  db/types.ts              row types (Task 12)
  db/repo.ts               Repo interface + UniqueViolation (Task 12)
  db/supabaseRepo.ts       Supabase implementation (Task 12)
  db/index.ts              getRepo() (Task 12)
  auth/commissioner.ts     tokens, hashing, slugs (Task 14)
  api/http.ts              HttpError, handle, parseBody, requireCommissioner (Task 15)
  views/round.ts           loadRoundView (Task 22)
  views/league.ts          loadLeagueView (Task 22)
scripts/
  capture-fixture.ts       (Task 11)
  rotate-admin-token.ts    (Task 21)
supabase/migrations/0001_init.sql   (Task 12)
tests/
  helpers/builders.ts      synthetic TBA data builders (Task 4)
  helpers/fixture.ts       loadFixture (Task 11)
  helpers/memoryRepo.ts    in-memory Repo (Task 12)
  helpers/api.ts           request builders for route tests (Task 15)
  fixtures/2025parr/*.json (Task 11)
  scoring/*.test.ts  rounds/*.test.ts  tba/*.test.ts  api/*.test.ts  views/*.test.ts
```

**Why this shape:** the engine is split by scoring category (one file per spec subsection) so each file fits in your head and has its own test file. `engine.ts` only assembles. Everything that touches the network or database sits behind two seams (`getTba` and `Repo`) so tests never need real TBA or real Supabase.

## Spec coverage map

| Spec section | Task |
|---|---|
| §3.2 snake draft, `P × R ≤ T` | 9, 18, 19 |
| §3.3 team pool, manual teams, B-teams | 3, 18 |
| §3.4.1–3.4.2 quals, RP, rank tiers | 5 |
| §3.4.3–3.4.4 alliances, playoffs, winner/finalist | 6 |
| §3.4.5–3.4.6 awards, OPR | 7 |
| §3.5 config copied into round | 2, 18 |
| §3.6 round points, standings, tie ranks | 9 |
| §3.7 adjustments | 9, 20 |
| §4 access model, tokens, passcode | 14, 15, 16, 26 |
| §5.1–5.3 public screens | 23, 24, 25 |
| §5.4–5.5 admin screens | 26, 27 |
| §6 schema, RLS | 12 |
| §7.3 cache layer, §8.3 rate limit | 13 |
| §7.4–7.7 extraction rules | 4, 5, 6 |
| §7.8 status, cache windows | 10 |
| §7.9 engine API | 8, 9 |
| §8.2 database asleep page | 24 |
| §8.4 validation, 409 mapping | 15, 17, 19 |
| §8.5 display edge cases | 23 |
| §9.2 caching pinned | 1, 13, 28 |
| §9.3 endpoints | 16–20 |
| §10 tests (1–7) | 5–11, 13, 15–20 |
| §10.8 replay dry run, §11 deploy | 28 |
| §4 lost-link recovery script | 21 |
