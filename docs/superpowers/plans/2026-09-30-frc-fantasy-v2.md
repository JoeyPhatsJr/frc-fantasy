# FRC Fantasy v2 Implementation Plan (index)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take FRC Fantasy from a family prototype to a community app: Google/Discord accounts, live phone drafts, draft-pool stats, and more league formats, with sign-in and the live draft ready for Ramp Riot draft night (Fri Oct 23, 2026).

**Architecture:** Evolve v1 in place. The server stays the only database client (RLS on, no policies, service-role key server-only); a session cookie from Supabase Auth replaces the commissioner token, checked in `lib/auth/`. Live drafts use two Postgres functions for atomic pick/undo, Supabase Realtime Broadcast as a data-free "doorbell", and polling as a fallback. Derived caches (`event_scores`, `team_stats`) sit beside `tba_cache`; scores are still a pure function of their inputs.

**Tech Stack:** Next.js 16.3 (App Router, `proxy.ts`, `after()`), React 19, TypeScript strict, Tailwind 4, Supabase Postgres + Auth + Realtime (`@supabase/supabase-js` 2, `@supabase/ssr`), zod 4, Vitest 5, Playwright (E2E, new), tsx for scripts, Vercel Hobby.

**Spec:** `docs/superpowers/specs/2026-09-30-frc-fantasy-v2-design.md` (the v2 spec; section numbers like §7.4 refer to it). It extends the v1 spec `docs/superpowers/specs/2026-09-29-frc-fantasy-design.md` ("v1 §x"). Executors read the v2 spec and the plan for their sub-project.

## Plan files — built in this order (spec §1.2)

| Build | File | Sub-project | Migration | Target dates |
|---|---|---|---|---|
| 1st | `2026-09-30-frc-fantasy-v2-sp1-accounts.md` | SP1 Accounts & leagues + landing page | `0002_accounts.sql` | Oct 1–5 |
| 2nd | `2026-09-30-frc-fantasy-v2-sp4-live-draft.md` | SP4 Live draft room | `0003_live_draft.sql` | Oct 6–10 |
| 3rd | `2026-09-30-frc-fantasy-v2-sp3-team-info.md` | SP3 `event_scores` + team info | `0004_team_stats.sql` | Oct 11–14 |
| 4th | `2026-09-30-frc-fantasy-v2-sp2-formats.md` | SP2 League formats | `0005_formats.sql` | Oct 15–18 (cuttable) |

Tasks are numbered per plan; refer to them as "SP1 Task 3". **Migration rule:** dev and production share one Supabase project and every migration here is additive, so each plan applies its migration at a Joey checkpoint in its first migration task (SP1 Task 2, SP4 Task 1, SP3 Task 1, SP2 Task 1); the live site ignores the new objects until the code merges. Each plan ends with a merge task: PR → merge to `main` → confirm the migration is in → deploy check. **Stop for Joey's "go" between plans** (and between task batches inside a plan when Joey asks).

## Global Constraints (every task in every plan)

- **The project path contains a space** (`~/Claude/FRC Fantasy`). Quote every path in shell commands. Run commands from the repo root.
- TypeScript `strict: true`. Import alias `@/` = repo root. No ESLint; the gates are `npm run typecheck` and `npm test`.
- Every page under `app/l/`, `app/me/`, `app/leagues/`, `app/join/` and every route handler under `app/api/` exports `export const dynamic = 'force-dynamic'`. Every `fetch` to TBA passes `cache: 'no-store'`. Pages/routes that call TBA export `export const maxDuration = 30`; the cron route exports `maxDuration = 60`.
- **Scores are computed, never stored** — except in the derived, rebuildable caches `event_scores` and `team_stats` (spec §5.6, §6.1), which are only written through their one module each.
- Server-only secrets: `TBA_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `E2E_AUTH_SECRET` (local only). Public by design: `NEXT_PUBLIC_SUPABASE_URL` (= `SUPABASE_URL`), `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `CREATE_LEAGUE_PASSCODE` is removed in SP1.
- **RLS on, no policies, for every table.** Every new SQL function: `revoke execute … from public, anon, authenticated;` then `grant execute … to service_role;`.
- The browser never queries Postgres. It talks only to our API routes, Supabase Auth (OAuth), and Supabase Realtime (subscribe only).
- Team keys match `^frc[1-9][0-9]{0,4}[A-Z]?$`; event keys match `^[0-9]{4}[a-z0-9]+$`. UUID path params are checked with `isUuid` (404 on junk).
- All route bodies are zod-validated through `parseBody`; every handler body is wrapped in `handle()` (`lib/api/http.ts`).
- Auth status codes: **401** signed out, **403** signed in but not allowed, **404** unknown league/round (and for bad invite codes). Members-only leagues show a "Private league" card, not a 404, to non-members on pages; their read APIs return 403.
- Names (display + player): 1–40 chars after trim, no control characters.
- UI: usable at 360 px, no horizontal scroll, tap targets ≥ 44 px (`min-h-11`), both themes (dark default, light toggle), tokens and components from `design-system/frc-fantasy/` and `components/ui/`.
- TBA fetch timeout 5 s; forced refresh ignored if the cache row is under 15 s old (v1 rules unchanged).
- TDD: write the failing test, watch it fail, implement, watch it pass, commit. Baseline before SP1: **490 passing tests**; the count only goes up (auth tests are rewritten, not deleted without replacement).
- Commit after every task. End every commit message with the `Co-Authored-By:` line from the session's attribution instructions (use the `subagent-commit-trailers` skill to verify after subagent commits).
- Migrations are additive until `0006_cleanup.sql` (after Ramp Riot); new `not null` columns always have defaults, so the previous deploy keeps working during a deploy.

## Cross-plan contract (names later plans rely on)

Each plan's tasks **produce** the names below exactly as written; later plans **consume** them. If a plan must change one, it updates this table in the same commit.

### From SP1 (accounts)

| Name | Where | Signature / shape |
|---|---|---|
| `SessionUser` | `lib/auth/session.ts` | `{ id: string; email: string \| null }` |
| `getUser` | `lib/auth/session.ts` | `(): Promise<SessionUser \| null>` — the only reader of the auth cookie |
| `requireUser` | `lib/auth/session.ts` | `(): Promise<SessionUser>`; throws `HttpError(401, 'Sign in first')` |
| `LeagueRole`, `Visibility` | `lib/db/types.ts` (`roles.ts` re-exports `LeagueRole`) | `'commissioner' \| 'player'`; `'link' \| 'members'` |
| `requireLeagueRole` | `lib/auth/roles.ts` | `(slug: string, role: LeagueRole): Promise<{ user: SessionUser; league: LeagueRow; player: PlayerRow }>`; 401 / 403 `'Forbidden'` / 404 `'League not found'`. `'player'` also admits commissioners |
| `requireLeagueView` | `lib/auth/roles.ts` | `(slug: string): Promise<{ user: SessionUser \| null; league: LeagueRow; player: PlayerRow \| null }>`; 404 unknown; 403 `'This league is private'` for non-members of `members` leagues |
| `leagueAccess` | `lib/auth/roles.ts` | `(slug: string) => Promise<LeagueAccess \| null>`; `LeagueAccess = { user; league; player; canView: boolean; isCommissioner: boolean }` (never throws; pages use it to choose between the league, the private card, and admin links) |
| `requireRound` | `lib/api/http.ts` (unchanged; SP1 only removes `requireCommissioner`) | `(league, roundId) => Promise<RoundRow>` |
| `PrivateLeague` | `components/PrivateLeague.tsx` | `({ signedIn: boolean; next: string })` — the members-only card; SP4's draft page reuses it |
| `loadMePage` | `lib/views/me.ts` | `(userId, now) => Promise<MePage>`; SP2 Task 18 extends it for season picks |
| `LeagueRow` additions | `lib/db/types.ts` | `inviteCode: string; visibility: 'link' \| 'members'; createdBy: string \| null; adminTokenHash: string \| null` |
| `PlayerRow` additions | `lib/db/types.ts` | `userId: string \| null; role: LeagueRole` |
| `ProfileRow` | `lib/db/types.ts` | `{ id: string; displayName: string; avatarUrl: string \| null; frcTeam: number \| null; createdAt: string }` |
| Repo additions | `lib/db/repo.ts` | `getProfile(id)`, `createProfile(input)`, `updateProfile(id, patch)`, `deleteUser(id)`; `getLeagueByInviteCode(code)`, `resetInviteCode(leagueId)`, `countLeaguesCreatedBy(userId)`, `listLeaguesForUser(userId)`; `createMember(input: { leagueId; userId; name; role })`, `getMemberByUser(leagueId, userId)`, `updatePlayer(id, patch: { name?; role?; userId?: null })`. `listLeaguesForUser` returns `{ league: LeagueRow; player: PlayerRow }[]`. `LeaguePatch.visibility?`. `createPlayer` stays for v1 tests and the seed script only |
| `createServerSupabase` / `createBrowserSupabase` | `lib/supabase/server.ts` / `lib/supabase/browser.ts` | `@supabase/ssr` clients (anon key) used **only** for Auth |
| Test helpers | `tests/helpers/auth.ts`, `tests/helpers/api.ts` | `vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession)`; `setUser(user \| null)`, `makeUser(repo, name?)`, `signInAsMember(repo, league, name?, role?)`. `seedLeague(repo, { name?, slug?, visibility?, signIn? })` returns `{ league, commissioner: PlayerRow, user: SessionUser }` and **signs the commissioner in** unless `signIn: false`; SP2 adds a `format?` option |
| `request()` | `tests/helpers/api.ts` | loses the `token` option (no more `x-commissioner-key`) |
| E2E login | `app/api/test/login/route.ts` | `POST { email, name? }` with `Authorization: Bearer $E2E_AUTH_SECRET` → `{ userId }`, sets the session cookie, creates the profile; 404 unless `E2E_AUTH_SECRET` is set and `VERCEL` is unset |

### From SP4 (live draft)

| Name | Where | Signature / shape |
|---|---|---|
| `RoundRow` additions | `lib/db/types.ts` | `draftMode: 'commissioner' \| 'live'; pickSeconds: 30 \| 60 \| 90 \| 120 \| null; draftStartedAt; draftPausedAt; pausedRemainingMs: number \| null; pickDeadline: string \| null` |
| `PickRow` addition | `lib/db/types.ts` | `auto: boolean`; `NewPick.auto?: boolean` (optional, default `false`) |
| `HttpError.code` | `lib/api/http.ts` | optional 3rd constructor arg; `handle()` returns `{ error, code }`. Live-draft codes: `not_your_turn`, `stale`, `taken`, `not_live` |
| `DraftPhase` / `draftPhase` | `lib/draft/live.ts` | `'setup' \| 'live' \| 'paused' \| 'done'`; `(round: RoundRow, pickCount: number) => DraftPhase` |
| `chooseAutoPick` | `lib/draft/live.ts` | `(queue: string[], available: { teamKey: string; proj: number \| null }[]) => string \| null` |
| `PoolEntry` | `lib/pool/entries.ts` | `{ teamKey; nickname: string \| null; proj: number \| null; record: [number, number, number] \| null; bestFinish: 'winner' \| 'finalist' \| 'captain' \| 'picked' \| null; opr: number \| null; rank: number \| null; available: boolean }` |
| `PoolStatsLookup` | `lib/pool/entries.ts` | `(teamKeys: string[], season: number) => Promise<Map<string, Omit<PoolEntry, 'teamKey' \| 'nickname' \| 'available'>>>`; `noPoolStats` (empty map) and `activePoolStats` (= `noPoolStats` in SP4; **SP3 changes this one constant** to `teamStatsPoolLookup`) |
| `buildPoolEntries` | `lib/pool/entries.ts` | `(round: RoundRow, now: Date, stats: PoolStatsLookup = activePoolStats) => Promise<PoolEntry[]>`, built on v1 `loadPool` |
| Pool UI | `components/draft/PoolList.tsx`, `lib/draft/poolView.ts` | `PoolList` (search, `filterSortPool` Proj/OPR/Number sort, Available only, footnote); SP3 Task 15 adds `slug`/`roundId` props and stat cells |
| Test helpers | `tests/helpers/draftMocks.ts`, `tests/helpers/draft.ts` | `mocks` (`repo`, `user`, `getTba`, `ring`), `resetDraftMocks`, `sessionModule`; `seedLiveDraft(repo, opts)`, `TBA_TEAMS`, `T0` |
| Repo additions | `lib/db/repo.ts` | `makePickAtomic(input: AtomicPick /* { roundId; pickNumber; playerId; teamKey; requireDue: boolean; auto: boolean } */): Promise<boolean>`, `undoPickAtomic(roundId, pickNumber): Promise<boolean>`, `draftControl(roundId, action: DraftAction /* 'start' \| 'pause' \| 'resume' */): Promise<boolean>`, `rlsDisabledTables(): Promise<string[]>`, `getQueue(roundId, playerId)`, `setQueue(roundId, playerId, teamKeys)`, `getAutodraft(roundId, playerId)`, `setAutodraft(roundId, playerId, on)`, `listAutodraftPlayers(roundId)`. `createMemoryRepo(opts?: { now?: () => Date })` (injectable clock) |
| SQL functions | `0003_live_draft.sql` | `draft_make_pick`, `draft_undo_pick`, `draft_control` (start/pause/resume on the database clock), `public_tables_without_rls()`; all service-role only |
| Draft control route | `app/api/l/[slug]/admin/rounds/[id]/draft/[action]/route.ts` | `POST` for `start` \| `pause` \| `resume` (URLs match spec §7.3) |
| `advance` | `lib/draft/advance.ts` | `(roundId: string, now: Date) => Promise<number>` (auto-picks made) |
| `ring` | `lib/realtime/doorbell.ts` | `(roundId: string) => Promise<void>` (never throws) |

### From SP3 (team info)

| Name | Where | Signature / shape |
|---|---|---|
| `getEventScores` | `lib/scores/eventScores.ts` | `(eventKey: string, config: ScoringConfig, windowMs: number, opts?: { now?: Date; repo?: Repo; tba?: Partial<TbaDeps> }) => Promise<{ scores: EventScores; info: EventInfo; stale: boolean; fetchedAt: string \| null }>`; `EventInfo = { teamNames: Record<string, string>; hasEventData: boolean; hasRankings: boolean }` |
| `loadEventData` | `lib/tba/event.ts` | gains optional `deps?: Partial<TbaDeps>`; `cleanEventData` moves to `lib/tba/clean.ts` (re-exported from `lib/views/round.ts`) |
| `serializeEventScores` / `deserializeEventScores` | `lib/scores/eventScores.ts` | `EventScores` ⇄ plain JSON |
| Repo additions | `lib/db/repo.ts` | `getCacheMeta(paths: string[])`, `getEventScoresRow(eventKey, configHash)`, `upsertEventScoresRow(row)`, `clearEventScores()`, `getTeamStats(teamKeys, seasons, opts?: { withHistory?: boolean })`, `upsertTeamStats(rows)` |
| `teamStatsPoolLookup`, `teamSheet`, `TeamSheetData` | `lib/stats/pool.ts` | a `PoolStatsLookup` reading `team_stats` + `projection`; the team-sheet data behind `GET /api/l/{slug}/rounds/{id}/pool/{teamKey}` |
| Pool formatters | `lib/pool/format.ts`, `components/pool/PoolStats.tsx` | `formatProj`, `formatRecord`, `formatOprRank`, `BEST_FINISH_LABEL`, `POOL_FOOTNOTE`; `NewChip`, `PoolStatCells`, `PoolFootnote` |
| `projection` | `lib/stats/projection.ts` | `(cur: SeasonTotals \| null, prev: SeasonTotals \| null) => number \| null` (`SeasonTotals` = points + events for one season) |
| Cron | `app/api/cron/daily/route.ts` | `GET`, bearer `CRON_SECRET`; runs `DAILY_JOBS: DailyJob[]` (`DailyJob = { name: string; run(now: Date, deadline: number): Promise<void> }`) via `runDailyJobs` from `lib/cron/jobs.ts`. **SP3 creates it** with the `team-stats` job and `vercel.json` (`0 10 * * *`); SP2 appends `follow-sync` and `season-dates` |

### From SP2 (formats)

Nothing later depends on SP2. It extends: `RoundRow` (`kind`, `seasonYear`, `poolFilter`, `autoAdded`; `eventKey` becomes `string | null`), `LeagueRow` (`format`, `followsSyncedAt`), `loadPool` (manual + season pools; return gains `emptyMessage: string | null`, checked by SP4's draft-start branch), `DAILY_JOBS`, `RpMethod` (`'manual'`, also added to SP3's `RP_METHODS`), `seedLeague` (`format?`), and SP1's `POST /api/leagues` + `CreateLeagueForm`. New seam: `scoreSourceFor(round, now): Promise<RoundScoreSource>` in `lib/rounds/scoreSource.ts` — `buildRoundView` calls it instead of `getEventScores` directly, and it dispatches `tba` (SP3's cached path, moved unchanged) / `manual` / `season`.

## Spec deviations across plans

Each plan lists its own deviations near the top; Joey should skim these before approving:

- **SP1** — "Deviations" section: Me | Leagues bar hidden on `/l/*` pages (v1's league TabBar is already a bottom bar); concrete route names for invites/me/profile; `POST /api/leagues` takes `{ name, visibility }` until SP2; `createPlayer` kept for tests/seed; Me "Live now" covers TBA rounds until SP2.
- **SP4** — "Deviations" section: a third locked SQL function `draft_control` (start/pause/resume on the database clock; spec §7.1 updated); `public_tables_without_rls()` for the smoke test; `HttpError.code` carries the 409 codes.
- **SP3** — "Deviations from the spec" section: `event_scores.info` column; bodies read on a miss; nothing cached if a path was never fetched; build script resumes via `tba_cache`; cron refreshes least-recently-updated teams first; "played" quals = quals with a result; team sheet skips excluded award types. Task 15 reuses SP4's pool list instead of building a second one.
- **SP2** — "Deviations" section: per-event rows labelled by date (no week field on Event_Simple); "4 in flight" = 4 event refreshes; "Other award" = TBA type 70; manual Results is a card; manual rounds left out of Me "Live now".

## Review Focus (whole v2)

Inputs the spec implies but no single happy-path test exercises, most likely to bite first. Each plan pins its own lines with a test in the owning task.

1. **Someone opens a league/admin/draft link while signed out, or signed in as the wrong person** → sign-in prompt (with `next` back to the same page) or "You're not a commissioner of this league", never a blank page or a 500. *(SP1)*
2. **Two phones tap Draft on the same pick at the same instant, or a `tick` lands during an undo** → exactly one pick is saved; the loser sees "341 was just taken — pick again" or a silent refresh. *(SP4)*
3. **A draft with auto-draft players at the start, after a resume, or after an undo** → the draft keeps moving; it never sits waiting on someone who's on auto-draft. *(SP4)*
4. **A phone's clock is wrong by minutes, or it sleeps and wakes mid-pick** → the countdown still matches the server; the server's deadline decides. *(SP4)*
5. **TBA is slow or down on a competition Saturday** → pages render with stale data and a stale marker, within the function time limit. *(SP3, SP2)*
