# FRC Fantasy

A fantasy draft league for FIRST Robotics Competition events, for family and friends. Before an event,
players take turns drafting the FRC teams competing there. Teams earn points from their real results on
The Blue Alliance. Each event is a round; rounds add up to season standings.

Design spec: `docs/superpowers/specs/2026-09-29-frc-fantasy-design.md`.

## How it works

- **Public link** `/l/<slug>`: the group-chat link. Leaderboards, rosters, every point explained.
- **Admin link** `/l/<slug>/admin#k=<token>`: the commissioner's link. Shown once when the league is
  created. Keep it private; anyone with it can change the league.
- Scores are never stored. They are recomputed from The Blue Alliance data every time a page loads, using
  the round's scoring table, the picks, and any manual adjustments.

## Running it locally

```bash
npm install
cp .env.example .env.local   # then fill in the four values below
npm run dev                  # http://localhost:3000
```

| Variable | Where it comes from |
|---|---|
| `TBA_API_KEY` | thebluealliance.com/account → Read API Keys |
| `SUPABASE_URL` | Supabase dashboard → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → service_role key. Server only. Never in the browser. |
| `CREATE_LEAGUE_PASSCODE` | Anything you like. Needed to create a league on the home page. |

Database setup, once: paste `supabase/migrations/0001_init.sql` into the Supabase SQL Editor and run it.

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
| `scripts/seed-demo.ts [site-url]` | Creates a demo league that replays Ramp Riot 2025. Note: creates a NEW league each run |
| `scripts/db-smoke.ts` | Checks the real database matches the code |
| `scripts/rotate-admin-token.ts <slug> [site-url]` | Makes a new admin link when the old one is lost |

Run them with `npx tsx --env-file=.env.local scripts/<name>.ts ...`. For example, the demo league:
`npx tsx --env-file=.env.local scripts/seed-demo.ts`.

## Live site

Production: https://frc-fantasy-6yo3.vercel.app (Vercel, deploys automatically from `main`).

## Design

The look and feel lives in `design-system/frc-fantasy/`. Start with `BRIEF.md` (the design direction and
why), then `MASTER.md` (the tokens, components, and rules the pages follow).

## Lost the admin link?

```bash
npx tsx --env-file=.env.local scripts/rotate-admin-token.ts <slug> https://<your-app>.vercel.app
```

It prints a new admin link. The old one stops working.

## Deploy checklist

Skip any item that is already done.

1. **Put the repo on GitHub.**
   - [ ] `gh auth status || gh auth login`
   - [ ] `gh repo create frc-fantasy --private --source=. --remote=origin --push`
   - [ ] Confirm `.env.local` is not in the file list on GitHub (`gh repo view --web`).
2. **Deploy to Vercel.**
   - [ ] At `https://vercel.com/new`, import the `frc-fantasy` repo. Framework preset: Next.js. Leave build
     settings alone.
   - [ ] Under Environment Variables, add `TBA_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
     `CREATE_LEAGUE_PASSCODE` (same values as `.env.local`).
   - [ ] Press Deploy. Expect a green build and a URL like `https://frc-fantasy-xxxx.vercel.app`.
   - [ ] Open the URL. Expect the home page.
3. **Create the real league on production.**
   - [ ] On the production home page, create the league (for example "Habich Fam") with the passcode.
   - [ ] Save the admin link in a password manager or private note. Copy the public link too.
   - [ ] In the admin page, add the family as players and add round `2025parr` for the replay.
4. **Prove nothing is cached by Next.js (spec section 9.2).**
   - [ ] Open the public round page for `2025parr` on your phone. Note a player's total.
   - [ ] On your laptop, in the round admin, add a player adjustment of +100 with the reason "cache test".
   - [ ] Reload the phone. The total should be 100 higher within a second or two, with no redeploy. If not,
     stop: something is caching. Check that the page exports `dynamic = 'force-dynamic'` and that no
     `fetch` lost its `cache: 'no-store'`.
   - [ ] Delete the "cache test" adjustment and reload. The total should be back.

## Before every event

1. **Wake the database.** Supabase free projects pause after about a week idle. Open the Supabase
   dashboard; if the project says "Paused", press "Restore project" and wait a minute. Do this the day
   before.
2. Open the public link on your phone and confirm it loads.
3. Check the event exists on The Blue Alliance and note its key (for Ramp Riot 2026, probably `2026parr`).
4. Add the round in the admin page and look at its team pool. Offseason lists are often incomplete: add
   missing teams by hand.
5. Set the draft order and roster size, then draft.

## During the event

- Pages refresh themselves every 60 seconds while a round is live.
- If The Blue Alliance is slow, pages show "Scores may be behind" and keep the last good numbers.
- "Refresh from TBA" in the round admin forces a check (at most once every 15 seconds).
- Things TBA doesn't have (offseason awards, a tied playoff match the refs decided) go in as
  **adjustments**, with a reason everyone can see.

## After the event

Results can keep arriving for a day or two. Once they look complete, press "Mark round final". That only
changes the badge and slows down data checks; the scores stay live.
