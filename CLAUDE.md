# FRC Fantasy

Fantasy draft league for FIRST Robotics Competition, for Joey (student on FRC team 5181), family, and friends. Players draft FRC teams before each event; teams earn points from real results pulled from The Blue Alliance (TBA). Each event is a round; rounds roll up into season standings.

**Hard deadline:** first live use at **Ramp Riot 2026 (Sat Oct 24, 2026)**. Draft night Oct 23. Feature freeze Oct 21.

## Source of truth

The design specs: v1 `docs/superpowers/specs/2026-09-29-frc-fantasy-design.md` and v2 `docs/superpowers/specs/2026-09-30-frc-fantasy-v2-design.md`, plus the v2 plan index `docs/superpowers/plans/2026-09-30-frc-fantasy-v2.md`. Read them before doing anything. They define the rules, scoring math, schema, API endpoints, caching, tests, and timeline. If code and spec disagree, raise it; don't silently diverge.

## Current status

- v1 is implemented and merged to `main` (Tasks 1–27 of `docs/superpowers/plans/2026-09-29-frc-fantasy-v1*.md`), reviewed task-by-task, with a design layer from `design-system/frc-fantasy/`.
- Local dev works against the real Supabase project; demo league seeded (`scripts/seed-demo.ts`).
- Deployed: https://frc-fantasy-6yo3.vercel.app (PR #1 merged 2026-09-30). The caching proof passed. The v1 test leagues were deleted 2026-09-30; the family league will be created fresh after the SP1 merge.
- UI overhaul shipped (PR #3, 2026-09-30): dark-first shell with light toggle, bumper plates, scoreboard leaderboards; brief in `design-system/frc-fantasy/OVERHAUL.md`. Its two cosmetic leftovers (draft banner wrapping at 360px, faint gold ring in light mode) were fixed 2026-09-30.
- v2 SP1 (accounts & leagues) merged <date>; next SP4 live draft. v2 roadmap: see memory v2-league-formats-idea.

## Locked decisions (don't re-litigate)

- **Format:** per-event snake drafts plus season standings. Not a full-season draft. Default rounds are events 5181 attends, plus occasional big events (Champs).
- **v1 draft:** happens in real life; the commissioner enters picks. The live in-app draft room is v2.
- **Access (v2):** Email + password via Supabase Auth (confirmation off, no emails sent; forgotten passwords reset with `scripts/reset-password.ts`); every player has an account; per-league visibility (`link` / `members`); invite codes. Admin-token links are gone. Google/Discord OAuth code is dormant.
- **Scoring:** results-based (qual W/T, RP, rank tiers, alliance selection, playoff wins, winner/finalist, awards) plus an OPR bonus for the top 3 after quals. The config is copied into each round.
- **Stats source:** TBA OPR. Statbotics is not used; it had no data for offseasons.
- **Stack:** Next.js App Router plus TypeScript, Tailwind, Supabase Postgres (free tier, service-role key server-only, RLS on with no policies), zod, Vitest, deployed on Vercel Hobby (free).
- **Caching:** Next.js caching is disabled (`force-dynamic`, `no-store`). The `tba_cache` table is the only cache.
- **Scores are computed, never stored.** They're a pure function of TBA data, the round config, picks, and adjustments.
- **Test data:** the Ramp Riot 2025 event (`2025parr`) is the fixture and replay test. Known quirks: 34 teams, no awards on TBA, Playoff Match 3 tied 156–156 (TBA later recorded blue as tiebreak winner), Alliance 2 had 4 picks, winner is Alliance 3, finalist is Alliance 4.
- **Priority 2 (stretch, only if the core is done by Oct 19):** the "Add 5181's events" helper, "the ones that got away", drag-to-reorder. (Dark mode shipped in the UI overhaul, PR #3.)

## Working with Joey

- High school student and vibecoder. Explain choices at a moderate level, since Joey is learning. Joey likes multiple-choice questions with a recommendation, one question at a time.
- Joey wants reviews before code gets written, and has used a Fable 5.1 review agent for that.
- Commit to git as work progresses. End commit messages with the Co-Authored-By line from the session's attribution instructions.

## Environment gotchas

- **The project path contains a space** (`~/claude/FRC Fantasy`). Always quote paths in shell commands.
- A GateGuard hook asks for "facts" before the first Bash and Write calls in a session. State them briefly, then retry.
- TBA API key needed: a free read key from thebluealliance.com/account, stored as `TBA_API_KEY` in `.env.local` (never committed).
- **The Supabase free tier pauses after about 7 days idle.** Wake it in the dashboard before events.
- Sign-in needs `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, locally and on Vercel (without them every request fails).
- Local sign-in shortcut for Playwright: `POST /api/test/login` with `Authorization: Bearer $E2E_AUTH_SECRET` — local only.
