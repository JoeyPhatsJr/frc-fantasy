# FRC Fantasy

A fantasy draft league for FIRST Robotics Competition events, for family and friends. Before an event,
players take turns drafting the FRC teams competing there. Teams earn points from their real results on
The Blue Alliance. Each event is a round; rounds add up to season standings.

Design specs: v1 `docs/superpowers/specs/2026-09-29-frc-fantasy-design.md`, v2 (accounts) `docs/superpowers/specs/2026-09-30-frc-fantasy-v2-design.md`.

## How it works

- **Sign in** with an email and password. Every player has an account.
- **League page** `/l/<slug>`: leaderboards, rosters, every point explained. Each league is either
  visible to anyone with the link, or to members only. Players join with an invite code
  (`/join/<code>`).
- **Admin page** `/l/<slug>/admin`: for commissioners only (see Commissioners below).
- Scores are never stored. They are recomputed from The Blue Alliance data every time a page loads, using
  the round's scoring table, the picks, and any manual adjustments.

## Running it locally

```bash
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev                  # http://localhost:3000
```

Then create an account with an email and password (one-time setup below).

| Variable | Where it comes from |
|---|---|
| `TBA_API_KEY` | thebluealliance.com/account → Read API Keys |
| `SUPABASE_URL` | Supabase dashboard → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → service_role key. Server only. Never in the browser. |
| `NEXT_PUBLIC_SUPABASE_URL` | Same value as `SUPABASE_URL`. Sign-in runs in the browser. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page → anon / publishable key. Public by design; RLS has no policies, so it can't touch our tables. |
| `CRON_SECRET` | 32+ random characters (`openssl rand -base64 32`). Used by the scheduled jobs. |
| `E2E_AUTH_SECRET` | Another random string. Local only, never on Vercel: lets Playwright sign in through `/api/test/login`. |

Database setup, once: paste the files in `supabase/migrations/` (`0001_init.sql`, `0002_accounts.sql`,
`0003_live_draft.sql`, `0004_team_stats.sql`) into the Supabase SQL Editor and run each one in order. Migration `0003` must be
applied before deploying SP4 (the live draft room), or the draft pages will fail.

## Live drafts (v2)

A round can be drafted two ways (round admin -> **Live draft** card):

- **Commissioner enters picks** — the v1 draft entry screen.
- **Live draft on everyone's phones** — pick a timer (off / 30 / 60 / 90 / 120 s), set the draft order, and press **Start draft**. Everyone opens the round's **draft room** (`/l/{slug}/r/{roundId}/draft`, also linked from the "Draft is live — join" banner). When a timer runs out, the server picks for that player: the first available team in their queue, else the lowest team number (projections arrive in SP3). Players can turn on **Auto-draft for me**. The commissioner can pause, resume, undo the last pick, and pick for whoever is on the clock.

Fallback: until the draft starts, a round can be switched back to commissioner entry.

### Live draft checks

- `npx tsx --env-file=.env.local scripts/smoke-v2.ts` — real-database checks (racing picks, undo vs timeout, pause/resume, RLS on, anon key locked out). Run after applying a migration.
- `npm run e2e` — two-phone live draft in Playwright against a local production build (port 3100, about 1-2 minutes; it cleans up its own league and users).

To run the E2E:

1. Apply migration `0003_live_draft.sql` to the Supabase project.
2. Make sure `.env.local` has `E2E_AUTH_SECRET` plus the Supabase keys and `TBA_API_KEY`, that `VERCEL` is unset, and that nothing else is running on port 3100. Never set `E2E_AUTH_SECRET` on Vercel.
3. `npx playwright install chromium` (once).
4. `npm run e2e`.
5. On a failure: `npx playwright show-trace test-results/*/trace.zip`.

## One-time sign-in setup

About 5 minutes, in the Supabase dashboard. Do it once per Supabase project. Sign-in is email + password;
no emails are ever sent. (Google/Discord sign-in code exists but is switched off.)

1. **Email provider.** Authentication → Sign In / Providers → Email: enabled, **Confirm email OFF**,
   minimum password length **8**. Leave **anonymous sign-ins off**.
2. **Site URL.** Authentication → URL Configuration: Site URL `https://frc-fantasy-6yo3.vercel.app`.
3. **Env vars.** Project Settings → API gives the Project URL and the anon / publishable key. Put them
   in `.env.local` as `NEXT_PUBLIC_SUPABASE_URL` (equal to `SUPABASE_URL`) and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, plus `CRON_SECRET` and `E2E_AUTH_SECRET` (each from
   `openssl rand -base64 32`); remove `CREATE_LEAGUE_PASSCODE`. Also set `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `CRON_SECRET` in Vercel (Production and Preview) **before merging
   SP1**, or every request will fail. Never put `E2E_AUTH_SECRET` on Vercel.

Check it: `npm run dev`, create an account with an email and password, and you should land back on `/`
signed in. Sign out from `/me/settings` and sign back in.

## Checks

```bash
npm test             # unit tests (scoring engine, TBA client, API routes)
npm run typecheck
npm run build
npx tsx --env-file=.env.local scripts/db-smoke.ts   # talks to the real database
```

## Scripts

| Script | What it does |
|---|---|
| `scripts/capture-fixture.ts <eventKey>` | Downloads an event's TBA data into `tests/fixtures/` |
| `scripts/seed-demo.ts <owner-user-id> [site-url]` | Creates a demo league that replays Ramp Riot 2025, owned by that user (find your id in Supabase → Authentication → Users; sign in once first). Note: creates a NEW league each run |
| `scripts/db-smoke.ts` | Checks the real database matches the code |
| `scripts/reset-password.ts <email> <new-password>` | Resets a forgotten password (no emails are sent), then you give the player the new one |
| `scripts/build-team-stats.ts <season>` | Builds the draft-pool stats (`team_stats`) for one season from TBA, ~5 requests/s. Safe to stop and rerun. Run for the last two seasons before a draft |
| `scripts/show-team-stats.ts <team> <season>` | Prints one team's stats rows and the projection a draft in that season shows |
| `scripts/rebuild-event-scores.ts` | Empties the `event_scores` cache. **Run it on production after any change to `lib/scoring/*`** (cached rows hold the old code's scores) |
| `scripts/backfill-body-hash.ts` | One-time, after migration 0004: fills `tba_cache.body_hash` for old rows |

Run them with `npx tsx --env-file=.env.local scripts/<name>.ts ...`. For example, the demo league:
`npx tsx --env-file=.env.local scripts/seed-demo.ts <your-user-id>`.

The one-time v1 cleanup (deleting the old pre-accounts leagues) was run on 2026-09-30; its script has
been removed.

### SP3 morning sequence (team info)

Migration `0004_team_stats.sql` is not applied yet. In this order:

1. Paste `supabase/migrations/0004_team_stats.sql` into the Supabase SQL Editor and run it.
2. `npx tsx --env-file=.env.local scripts/backfill-body-hash.ts`
3. `npx tsx --env-file=.env.local scripts/build-team-stats.ts 2025`
4. `npx tsx --env-file=.env.local scripts/build-team-stats.ts 2026`
5. `npx tsx --env-file=.env.local scripts/show-team-stats.ts 5181 2026` (sanity check: 5181's rows and projection)

Also set `CRON_SECRET` in Vercel (Production and Preview) **before merging SP3**: `vercel.json` adds a daily cron
that fails without it.

## Daily cron

Vercel calls `GET /api/cron/daily` once a day (06:00 Eastern, `vercel.json`). It needs `CRON_SECRET` set in Vercel's
environment variables; Vercel sends it as `Authorization: Bearer ...` automatically. Each run gets 50 seconds:

- **team-stats** — re-scores this season's events from the last 8 days and refreshes those teams' `team_stats` rows.
  If it runs out of time it says so in the log, and the next day's run continues with the teams it missed.

To run it by hand (for example right after an event):
`curl -H "Authorization: Bearer $CRON_SECRET" https://frc-fantasy-6yo3.vercel.app/api/cron/daily`
Logs: Vercel dashboard -> the project -> Logs, filter by `/api/cron/daily`. The daily call also keeps the Supabase
free-tier project from pausing.

## Live site

Production: https://frc-fantasy-6yo3.vercel.app (Vercel, deploys automatically from `main`).

## Design

The look and feel lives in `design-system/frc-fantasy/`. Start with `OVERHAUL.md` (the current
direction: dark-first with a light toggle, bumper-plate team numbers, scoreboard leaderboards, the
app shell with the bottom tab bar). `BRIEF.md` is the original v1 light-theme brief and `MASTER.md`
the generated token reference; `OVERHAUL.md` wins where they disagree.

The theme is remembered per device in `localStorage['frcf:theme']` and follows the system setting
until you flip the sun/moon toggle in the header.

## Commissioners

The person who creates a league is its commissioner. A commissioner can make other members
commissioners from Admin → Members. A league always keeps at least one commissioner.

## Deploy checklist

Skip any item that is already done.

1. **Put the repo on GitHub.**
   - [x] `gh auth status || gh auth login`
   - [x] `gh repo create frc-fantasy --private --source=. --remote=origin --push`
   - [x] Confirm `.env.local` is not in the file list on GitHub (`gh repo view --web`).
2. **Deploy to Vercel.**
   - [x] At `https://vercel.com/new`, import the `frc-fantasy` repo. Framework preset: Next.js. Leave build
     settings alone.
   - [x] Under Environment Variables, add `TBA_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`
     (same values as `.env.local`).
   - [ ] For accounts (Production and Preview), also add `NEXT_PUBLIC_SUPABASE_URL`,
     `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `CRON_SECRET`. Never add `E2E_AUTH_SECRET`.
   - [x] Press Deploy. Expect a green build and a URL like `https://frc-fantasy-xxxx.vercel.app`.
   - [x] Open the URL. Expect the home page.
3. **Create the real league on production.** (The v1 league was removed in the 2026-09-30 cleanup.)
   - [ ] Sign in on the production home page and create the league (for example "Habich Fam").
   - [ ] Copy the invite link from Admin → Members and send it to the family. Each person signs in and
     joins with it; nobody can be added by name any more.
   - [ ] In the admin page, add round `2025parr` for the replay.
4. **Prove nothing is cached by Next.js (spec section 9.2).**
   - [x] Open the public round page for `2025parr` on your phone. Note a player's total.
   - [x] On your laptop, in the round admin, add a player adjustment of +100 with the reason "cache test".
   - [x] Reload the phone. The total should be 100 higher within a second or two, with no redeploy. If not,
     stop: something is caching. Check that the page exports `dynamic = 'force-dynamic'` and that no
     `fetch` lost its `cache: 'no-store'`.
   - [x] Delete the "cache test" adjustment and reload. The total should be back.

## Before every event

1. **Wake the database.** Supabase free projects pause after about a week idle. Open the Supabase
   dashboard; if the project says "Paused", press "Restore project" and wait a minute. Do this the day
   before.
2. Open the league link on your phone, **check you can sign in on your phone**, and confirm it loads.
3. Check the event exists on The Blue Alliance and note its key (for Ramp Riot 2026, probably `2026parr`).
4. Add the round in the admin page and look at its team pool. Offseason lists are often incomplete: add
   missing teams by hand.
5. Set the draft order and roster size, then draft.

## During the event

- Pages refresh themselves every 60 seconds while the tab is visible.
- If The Blue Alliance is slow, pages show "Scores may be behind" and keep the last good numbers.
- "Refresh from TBA" in the round admin forces a check (at most once every 15 seconds).
- Things TBA doesn't have (offseason awards, a tied playoff match the refs decided) go in as
  **adjustments**, with a reason everyone can see.

## After the event

Results can keep arriving for a day or two. Once they look complete, press "Mark round final". That only
changes the badge and slows down data checks; the scores stay live.
