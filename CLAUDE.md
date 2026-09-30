# FRC Fantasy

Fantasy draft league for FIRST Robotics Competition, for Joey (student on FRC team 5181), family, and friends. Players draft FRC teams before each event; teams earn points from real results pulled from The Blue Alliance (TBA). Each event is a round; rounds roll up into season standings.

**Hard deadline:** first live use at **Ramp Riot 2026 (Sat Oct 24, 2026)**. Draft night Oct 23. Feature freeze Oct 21.

## Source of truth

The design spec: `docs/superpowers/specs/2026-09-29-frc-fantasy-design.md`. Read it before doing anything. It defines the rules, scoring math, schema, API endpoints, caching, tests, and timeline. If code and spec disagree, raise it; don't silently diverge.

## Current status

- Spec is **Draft v2**, approved by Joey on 2026-09-29.
- **Implementation plan written** (2026-09-29), 28 tasks in four files: `docs/superpowers/plans/2026-09-29-frc-fantasy-v1.md` (index: constraints, deviations, review focus) plus `-part-1-engine.md`, `-part-2-data-api.md`, `-part-3-ui.md`.
- **Joey has NOT yet reviewed the plan.** The first step in a new session is to confirm the plan (and its 7 flagged deviations in the index) or collect changes, and pick an execution method (subagent-driven vs native).
- No product code exists yet. Task 11 needs Joey's TBA key in `.env.local`; Task 12 needs a Supabase project.

## Locked decisions (don't re-litigate)

- **Format:** per-event snake drafts plus season standings. Not a full-season draft. Default rounds are events 5181 attends, plus occasional big events (Champs).
- **v1 draft:** happens in real life; the commissioner enters picks. The live in-app draft room is v2.
- **v1 access:** no player accounts. A public view link, plus a secret commissioner link (token in the URL `#fragment`). Accounts are v2.
- **Scoring:** results-based (qual W/T, RP, rank tiers, alliance selection, playoff wins, winner/finalist, awards) plus an OPR bonus for the top 3 after quals. The config is copied into each round.
- **Stats source:** TBA OPR. Statbotics is not used; it had no data for offseasons.
- **Stack:** Next.js App Router plus TypeScript, Tailwind, Supabase Postgres (free tier, service-role key server-only, RLS on with no policies), zod, Vitest, deployed on Vercel Hobby (free).
- **Caching:** Next.js caching is disabled (`force-dynamic`, `no-store`). The `tba_cache` table is the only cache.
- **Scores are computed, never stored.** They're a pure function of TBA data, the round config, picks, and adjustments.
- **Test data:** the Ramp Riot 2025 event (`2025parr`) is the fixture and replay test. Known quirks: 34 teams, no awards on TBA, Playoff Match 3 tied 156–156, Alliance 2 had 4 picks, winner is Alliance 3, finalist is Alliance 4.
- **Priority 2 (stretch, only if the core is done by Oct 19):** the "Add 5181's events" helper, "the ones that got away", dark mode, drag-to-reorder.

## Working with Joey

- High school student and vibecoder. Explain choices at a moderate level, since Joey is learning. Joey likes multiple-choice questions with a recommendation, one question at a time.
- Joey wants reviews before code gets written, and has used a Fable 5.1 review agent for that.
- Commit to git as work progresses. End commit messages with the Co-Authored-By line from the session's attribution instructions.

## Environment gotchas

- **The project path contains a space** (`~/claude/FRC Fantasy`). Always quote paths in shell commands.
- A GateGuard hook asks for "facts" before the first Bash and Write calls in a session. State them briefly, then retry.
- TBA API key needed: a free read key from thebluealliance.com/account, stored as `TBA_API_KEY` in `.env.local` (never committed).
- **The Supabase free tier pauses after about 7 days idle.** Wake it in the dashboard before events.
