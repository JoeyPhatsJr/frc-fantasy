# FRC Fantasy — Design Spec

- **Date:** 2026-09-29
- **Author:** Joey (FRC Team 5181), with Claude
- **Status:** Draft v2 — approved by Joey 2026-09-29; implemented on branch v1 (see docs/superpowers/plans/)
- **First live use:** Ramp Riot 2026 (Team 341's offseason event, Ambler PA) — **Saturday, October 24, 2026**

---

## 1. Purpose

A fantasy league for FIRST Robotics Competition, played by Joey, family, and friends. Before an event, players take turns drafting FRC teams attending that event. Drafted teams earn fantasy points from their real results (wins, ranking points, seeding, alliance selection, playoffs, awards) plus a small stats bonus. Each event is a **round**; round points roll up into **season standings**.

### 1.1 Why this exists

- **Fun and show-off value** for a small, known audience (family + friends), not strangers.
- Give family members who aren't deep into FRC a reason to watch *every* match, not just 5181's.
- Trash talk. ("You drafted WHO?")

### 1.2 Success criteria

1. At Ramp Riot 2026, the family is refreshing the leaderboard between matches and roasting each other's picks.
2. Scores update from The Blue Alliance with no one hand-typing match results.
3. A non-technical family member can open the group-chat link on their phone and understand the leaderboard without instructions.
4. Replaying Ramp Riot 2025 (`2025parr`) produces scores that feel fair and fun (validated before Oct 24).

### 1.3 Non-goals for v1

Explicitly **out of scope** for the Oct 24 release (candidates for v2):

- User accounts / login for players
- Live in-app draft room (real-time, turn timers)
- Trades, waivers, free agents, mid-event roster changes by players
- Push/SMS notifications
- Full-season (draft-once) format
- Multiple commissioners per league
- Native mobile app

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **League** | A group of players who compete across a season. Has one commissioner. |
| **Player** | A person in the league (e.g. "Mom"). Not an FRC team. No account in v1. |
| **Commissioner** | The person who runs the league (Joey). Holds the secret admin link. |
| **Round** | One FRC event within a league (e.g. Ramp Riot 2026). Has its own draft, roster size, and scoring table. |
| **FRC team** | A robotics team, identified by TBA key `frc<number>` (e.g. `frc341`). |
| **Pick** | An assignment of one FRC team to one player in one round. |
| **TBA** | The Blue Alliance — source of all event data. API v3. |
| **Event key** | TBA identifier for an event: `<year><code>`, e.g. `2025parr`. |
| **RP** | Ranking points, earned in qualification matches; determine qualification rank. |
| **OPR** | Offensive Power Rating — least-squares estimate of each team's scoring contribution. TBA computes it per event. |
| **Snake draft** | Draft order reverses each round of picks: 1-2-3-3-2-1-1-2-3… |

---

## 3. Game rules (v1)

### 3.1 League structure

- A league has **players** and an ordered list of **rounds**.
- Each round is tied to exactly one TBA event key.
- A league may have any number of rounds. Intended default: events 5181 attends, plus occasional marquee events (e.g. Championship/Einstein) as bonus rounds.
- **Season standings** = for each player, the sum of their round points across all rounds of the league (see §3.6).

### 3.2 Draft

- Each round has a **draft order** (a permutation of the league's players participating in that round) and a **roster size** `R` (integer, 1–10, default 4).
- Draft format is **snake**. With `P` participating players and 0-indexed overall pick number `n`:
  - `draftRound = floor(n / P)`
  - `slot = n mod P`
  - picker = `draftRound` even ? `order[slot]` : `order[P - 1 - slot]`
- Total picks in a round = `P × R`.
- **Constraint:** `P × R ≤ T`, where `T` is the number of FRC teams in the round's team pool (§3.3). The commissioner UI must block starting a draft that violates this and show the maximum allowed `R`.
- **Uniqueness:** within a single round, each FRC team may be owned by at most one player. Enforced by a database unique constraint (§6).
- The same FRC team may be drafted again in a later round (rounds are independent).
- In v1 the draft happens in real life; the commissioner enters picks in order (§5.5).
- **Player participation:** not every league player must participate in every round. The round's draft order defines who participates. A non-participating player earns 0 round points for that round.

### 3.3 Team pool

- The team pool for a round is TBA's team list for the event (`/event/{key}/teams/simple`).
- **Offseason risk:** offseason team lists may be missing or incomplete on TBA until close to (or after) the event. Therefore the commissioner may **manually add team numbers** to a round's pool. Manually added teams are stored in `round_extra_teams` (§6) and merged with TBA's list (deduplicated by team key).
- A drafted team that never plays (withdrew, no-show) simply earns 0. The commissioner may use **replace pick** (§5.5) to fix it before the event starts.
- **Offseason team keys are weird, and that's normal:**
  - **B-teams:** events may remap a second robot from a team to a lettered key, e.g. `frc341B` (TBA `Event.remap_teams`). Team keys therefore allow an optional single uppercase letter suffix everywhere (§6.1).
  - **Placeholder numbers:** unregistered/demo teams often appear with placeholder numbers ≥ 9970 (Ramp Riot 2025 used 9979–9999 and 10157). They are ordinary draftable teams.

### 3.4 Scoring

Every scoring value is configurable per round (§3.5). Defaults below. All categories **stack** (e.g. a team can earn captain points *and* winner points).

#### 3.4.1 Qualification results

| Category | Default | Source / rule |
|---|---|---|
| Qual win | 3 per win | `rankings[].record.wins` |
| Qual tie | 1 per tie | `rankings[].record.ties` |
| Qual loss | 0 per loss | `rankings[].record.losses` (configurable as `qualLoss`, may be negative) |
| Ranking points | 1 per RP | Total RP — see §7.4 for extraction |

**Note on double-counting (intentional):** in recent games a qual win also awards win-RPs (e.g. 3 RP in 2025). With defaults a qual win is worth 3 (win) + 3 (RP) = 6 plus any bonus RPs. This is accepted: it makes winning matter most while bonus RPs still differentiate teams. The commissioner can lower `qualWin` if it feels too heavy after the replay test.

#### 3.4.2 Qualification rank (seeding)

Tiers are **non-cumulative** — a team gets exactly one tier's points:

| Final rank | Default |
|---|---|
| #1 | 10 |
| #2 – #8 | 5 |
| #9 – #16 | 2 |
| #17+ | 0 |

- During qualifications this is scored from the **current** rank and labeled "current rank" in the UI (points can move up or down while quals run). Once quals are complete (§7.6) it is labeled "final rank".
- Tier boundaries are configurable as a list of `{ maxRank, points }` sorted ascending by `maxRank`; a team gets the points of the first tier whose `maxRank ≥ rank`.

#### 3.4.3 Alliance selection

From `/event/{key}/alliances`, `alliance.picks` (ordered array of team keys):

| Position | Default |
|---|---|
| `picks[0]` — captain | 8 |
| `picks[1]` — first pick | 6 |
| `picks[2]` — second pick | 3 |
| `picks[3]` — third pick (4-team alliances, if present) | 2 |
| `backup.in` — backup robot called in | 2 |
| Declined an invitation | 0 |

- A team appears on at most one alliance. If data is inconsistent and a team appears twice, it scores only its first (highest-valued) position.

#### 3.4.4 Playoffs

| Category | Default | Rule |
|---|---|---|
| Playoff match win | 4 per win | For each match with `comp_level ≠ "qm"` that has a result (§7.5) and a winning alliance, every team in that alliance's `team_keys` for that match earns the points. Teams in `surrogate_team_keys` or `dq_team_keys` for that match do not. If TBA reports no winner (`winning_alliance == ""`), the match awards nothing (see §7.5 — this happens for tiebreak-decided matches at offseasons). |
| Event winner | 15 | Every team on the winning alliance (all of `picks` plus `backup.in` if present). |
| Event finalist | 8 | Every team on the runner-up alliance (same membership rule). |

Winner/finalist determination is specified in §7.7.

**Why "teams who played" for match wins but "whole alliance" for winner/finalist:** match wins are per-match facts from match data alone; winning the event is an alliance achievement, and the 4th robot on a winning alliance is still an event winner.

#### 3.4.5 Awards

From `/event/{key}/awards`. Award points go to each recipient entry with a non-null `team_key`.

| Award (`award_type`) | Default |
|---|---|
| Impact / Chairman's (0) | 10 |
| Engineering Inspiration (9) | 8 |
| Rookie All-Star (10) | 6 |
| Winner (1), Finalist (2) | **excluded** — already scored via §3.4.4 |
| Woodie Flowers (3), Dean's List (4), Volunteer (5), Founder's (6), Bart Kamen Memorial (7) | **excluded** — individual awards (TBA still attaches a `team_key`) |
| Highest Rookie Seed (14), #1 Seed (39) | **excluded** — already scored via rank tiers §3.4.2 |
| Any other award with a team recipient | 5 |

- Enum values above were verified against TBA's OpenAPI `AwardType` (x-enum-varnames) during review.
- **Offseason note:** Ramp Riot 2025 had **no awards on TBA**. Awards are therefore commonly scored via **manual adjustments** (§3.7) at offseasons. If TBA returns no awards, the awards category is simply 0.

#### 3.4.6 Stats bonus (OPR)

- After qualifications are complete (§7.6), teams are ranked by TBA OPR at this event (`/event/{key}/oprs` → `oprs[teamKey]`).
- Default bonus: OPR rank #1 → **+6**, #2 → **+4**, #3 → **+2**.
- **Ties:** standard competition ranking ("1,1,3"): tied teams share the better place and the next place is skipped. OPRs are floats; two OPRs are equal when they differ by less than `1e-6`.
- **Before quals complete:** no OPR bonus is awarded (early-event OPR is too noisy). The UI shows "OPR bonus: after quals".
- OPR is computed over **all teams in the event**, not only drafted teams.
- If TBA returns no OPRs (e.g. no match scores posted), the bonus is 0 for all teams.

### 3.5 Scoring configuration

- The league has a **default scoring config** (JSON, §6.2).
- When a round is created, the league default is **copied** into the round. Editing a round's config affects only that round. Editing the league default affects only rounds created afterwards.
- **Rationale:** changing the points table mid-season must not silently rewrite earlier rounds' results.

### 3.6 Player round points and season standings

- **Team points (round)** = sum of all categories in §3.4 for that team at that event.
- **Player round points** = sum of team points for every team the player drafted in that round + sum of that player's manual adjustments in that round (§3.7).
- **Season points** = sum of player round points across all rounds in the league.
- **Leaderboard ordering:** descending points; ties share a rank (1,1,3); within a tie, order alphabetically by player name for stable display.

### 3.7 Manual adjustments

- The commissioner can add adjustments to a round: `{ target, points (integer, may be negative), reason (text, required, ≤ 200 chars) }`.
- `target` is either a **player** (applies directly to that player) or an **FRC team** (applies to whoever owns that team in that round; shown in that team's breakdown, e.g. "Industrial Design Award +5"). A team-targeted adjustment on an undrafted team affects no one but is still stored and displayed on the round page.
- Adjustments are listed publicly with their reason (transparency is part of the fun).
- Adjustments can be edited or deleted by the commissioner.

---

## 4. Users & access model

| Role | How they access | Can do |
|---|---|---|
| **Viewer** (any player/family) | Public league link `/l/{slug}` | View everything: leaderboards, rosters, breakdowns, adjustments, draft boards |
| **Commissioner** | Secret admin link `/l/{slug}/admin#k={token}` | Everything a viewer can, plus all mutations for that league |
| **League creator** | Site root `/`, with site passcode | Create a new league (becomes its commissioner) |

- **No player accounts in v1.** Players are names typed by the commissioner.
- The league `slug` is not secret but not easily guessable (name-derived + 6 random base32 chars, e.g. `habich-fam-k3x9qd`).
- The commissioner token is a random 32-byte value (base64url). Only its SHA-256 hash is stored. It is shown **once** at league creation, together with the full admin link, with a prominent "save this link" warning.
- The token lives in the URL **fragment** (`#k=…`) so it is never sent to servers in request lines or logged by hosts/proxies. The admin page's client code:
  1. reads the fragment,
  2. stores the token in `localStorage` under `frcf:admin:{slug}` (so revisiting `/l/{slug}/admin` without the fragment works on that device),
  3. **removes the fragment from the address bar** with `history.replaceState` (so the commissioner can't accidentally share the admin URL from the phone share sheet),
  4. sends the token on every admin API call as the `x-commissioner-key` header.
- Because the server never sees the fragment, the admin pages are **client-rendered shells** that load their data from admin API endpoints with the header (§9.3). The first call is `GET /api/l/{slug}/admin/verify`; on 403 the page shows "This admin link is invalid".
- All mutation endpoints verify `sha256(header) == leagues.admin_token_hash` using a constant-time comparison. On mismatch: HTTP 403, no detail.
- **Lost admin link recovery:** out of band — regenerate via a one-off script run with the Supabase service key (`scripts/rotate-admin-token.ts <slug>`), which prints a new admin link. Documented in README.
- **League creation passcode:** env var `CREATE_LEAGUE_PASSCODE`. Prevents random internet visitors from creating leagues on Joey's free tier.

---

## 5. Screens (mobile-first)

All pages must be usable one-handed on a phone at 360px width. No horizontal scrolling. Large tap targets (≥ 44px).

### 5.1 `/` — Home

- Short explanation of FRC Fantasy.
- **Create league** form: league name, site passcode. On success: shows the public link and admin link (copy buttons), with the "save your admin link — it can't be recovered from the app" warning.

### 5.2 `/l/{slug}` — League page (public; the group-chat link)

- League name.
- **Season leaderboard**: rank, player name, season points, and a mini per-round breakdown.
- **Rounds list**: each round with event name, dates, status badge (Setup / Drafting / Upcoming / Live / Awaiting final / Final — §7.8), and link to the round page.
- If a round is Live, it is pinned at the top with its current leaderboard.
- "Last updated X min ago" for live data; stale warning if the TBA fetch failed (§8).
- Auto-refresh every 60 s while the tab is visible.

### 5.3 `/l/{slug}/r/{roundId}` — Round page (public)

- Event name, TBA link, dates, status.
- **Round leaderboard**: rank, player, round points.
- **Rosters**: each player's drafted teams with each team's point total; tap a player to expand the full breakdown (below).
- **Per-team breakdown** (expanded): one line per non-zero category, e.g.:
  - `341 Miss Daisy — 47 pts`
  - `Qual record 7-2-0 → +21`
  - `Ranking points 22 → +22`
  - `Current rank #3 → +5` (or "Final rank")
  - `Alliance captain → +8`
  - `Playoff wins ×3 → +12`
  - `Adjustment: Industrial Design Award → +5`
- **Draft board**: grid of picks (draft round × slot) showing who took whom and in which order.
- **Adjustments list** with reasons.
- *(Priority 2 — stretch)* **Undrafted notable teams**: the top 5 scoring undrafted teams ("the ones that got away") — cheap to compute, big trash-talk value.

### 5.4 `/l/{slug}/admin` — Commissioner dashboard

Requires a valid token (fragment or localStorage). If none or invalid: "This admin link is invalid" and nothing else.

**League section**
- Rename league.
- Players: add, rename, remove. A player who has picks or adjustments in any round, **or appears in any round's draft order**, cannot be removed (UI explains why); they can be renamed. Player names are unique within a league **case-insensitively** ("Mom" and "mom" collide).
- Edit league default scoring config (form with all fields from §6.2, with "reset to defaults").

**Rounds section**
- **Add round** by event key (validated against TBA `/event/{key}`; shows event name/dates for confirmation).
- *(Priority 2 — stretch)* **"Add 5181's events"** helper: calls TBA `/team/frc5181/events/{year}/simple` for the current year and lists events not already in the league, each with an "add" button. The team number is configurable in league settings (default 5181).
- Delete round (confirmation dialog; deletes its picks and adjustments).

### 5.5 `/l/{slug}/admin/r/{roundId}` — Round admin

- **Setup**: roster size, participating players & draft order (up/down buttons to reorder, or "randomize"), team pool (TBA list + manually added teams with "add team number" input), scoring config for this round.
- **Draft entry**:
  - Banner: "Pick 7 of 20 — Mom's turn (round 2)".
  - Search box filtering available teams by number or nickname; tapping a team records the pick for the current picker immediately (no confirm dialog — speed matters at the dinner table).
  - **Undo last pick**.
  - **Replace pick**: change which team a past pick refers to (must be an available team). Does not change pick order.
  - Draft board preview.
- **Adjustments**: add/edit/delete (§3.7).
- **Refresh from TBA** button (forces a cache refresh; rate-limited, §8.3).
- **Mark round final** / reopen (§7.8). When today is past `end_date + 1 day` and the round isn't final, show a nudge: "Event's over — mark final once results look complete."

---

## 6. Data model (Supabase Postgres)

### 6.1 Tables

```sql
create table leagues (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  name              text not null check (char_length(name) between 1 and 80),
  admin_token_hash  text not null,              -- hex sha256 of the admin token
  home_team_number  integer not null default 5181,
  default_scoring   jsonb not null,             -- ScoringConfig (§6.2)
  created_at        timestamptz not null default now()
);

create table players (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references leagues(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  created_at  timestamptz not null default now()
);
create unique index players_league_name_ci on players (league_id, lower(name));

create table rounds (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references leagues(id) on delete cascade,
  event_key     text not null check (event_key ~ '^[0-9]{4}[a-z0-9]+$'),
  event_name    text not null,                 -- cached from TBA at creation
  start_date    date not null,                 -- required in TBA Event_Simple
  end_date      date not null,
  timezone      text not null default 'America/New_York',  -- IANA tz from TBA /event/{key}.timezone; default if TBA gives none
  roster_size   integer not null default 4 check (roster_size between 1 and 10),
  draft_order   uuid[] not null default '{}',  -- player ids, participating players only
  scoring       jsonb not null,                -- ScoringConfig copied from league at creation
  finalized_at  timestamptz,                   -- null = not final (§7.8)
  created_at    timestamptz not null default now(),
  unique (league_id, event_key)
);

create table round_extra_teams (
  round_id  uuid not null references rounds(id) on delete cascade,
  team_key  text not null check (team_key ~ '^frc[1-9][0-9]{0,4}[A-Z]?$'),
  primary key (round_id, team_key)
);

create table picks (
  id           uuid primary key default gen_random_uuid(),
  round_id     uuid not null references rounds(id) on delete cascade,
  pick_number  integer not null check (pick_number >= 0),   -- 0-indexed overall pick
  player_id    uuid not null references players(id) on delete cascade,  -- removal of in-use players is blocked in app code (§5.4); cascade keeps league deletion working
  team_key     text not null check (team_key ~ '^frc[1-9][0-9]{0,4}[A-Z]?$'),
  created_at   timestamptz not null default now(),
  constraint picks_round_pick_number_key unique (round_id, pick_number),
  constraint picks_round_team_key unique (round_id, team_key)
);

create table adjustments (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references rounds(id) on delete cascade,
  player_id   uuid references players(id) on delete cascade,
  team_key    text check (team_key ~ '^frc[1-9][0-9]{0,4}[A-Z]?$'),
  points      integer not null check (points between -1000 and 1000),
  reason      text not null check (char_length(reason) between 1 and 200),
  created_at  timestamptz not null default now(),
  check ((player_id is null) <> (team_key is null))          -- exactly one target
);

create table tba_cache (
  path        text primary key,          -- e.g. '/event/2025parr/matches/simple'
  etag        text,
  body        jsonb,                     -- SQL NULL = TBA had no data yet (JSON null or 404)
  fetched_at  timestamptz not null,      -- last time we successfully talked to TBA (200 or 304)
  last_error  text,                      -- last failure message, null if last attempt succeeded
  last_error_at timestamptz
);
```

**Integrity rules enforced in application code (not expressible as simple constraints):**
- Every `rounds.draft_order` element must be a player of the same league, with no duplicates. (`uuid[]` has no foreign key, so this is also why players in any draft order cannot be removed — §5.4.)
- `picks.player_id` must equal the snake-order picker for `pick_number` given the round's `draft_order` at the time of the pick.
- `picks.pick_number` values in a round must be contiguous from 0 (enforced by only allowing append-next and undo-last).
- `adjustments.player_id` must belong to the round's league.
- Changing `draft_order` or `roster_size` is **blocked once any pick exists** in the round (UI shows "undo all picks to change draft order"). This prevents existing picks from becoming inconsistent with the snake formula.

### 6.2 `ScoringConfig` JSON (with defaults)

```json
{
  "version": 1,
  "qualWin": 3,
  "qualTie": 1,
  "qualLoss": 0,
  "rankingPoint": 1,
  "rankTiers": [
    { "maxRank": 1,  "points": 10 },
    { "maxRank": 8,  "points": 5 },
    { "maxRank": 16, "points": 2 }
  ],
  "alliance": { "captain": 8, "pick1": 6, "pick2": 3, "pick3": 2, "backup": 2 },
  "playoffMatchWin": 4,
  "eventWinner": 15,
  "eventFinalist": 8,
  "awards": {
    "byType": { "0": 10, "9": 8, "10": 6 },
    "excludedTypes": [1, 2, 3, 4, 5, 6, 7, 14, 39],
    "default": 5
  },
  "oprBonus": [6, 4, 2]
}
```

Validated with a zod schema on every write. All numbers are integers in `[-1000, 1000]`. `rankTiers` must be strictly ascending by `maxRank`. `oprBonus` length 0–10.

### 6.3 Row-level security

- RLS is **enabled on every table with no policies**, so the Supabase anon key can read/write nothing.
- All database access happens server-side (Next.js server components and route handlers) using the **service role key**, which exists only in server env vars.
- The Supabase anon key is not used in v1 (reserved for v2 realtime/auth).

---

## 7. TBA integration & scoring engine

### 7.1 TBA API basics

- Base URL: `https://www.thebluealliance.com/api/v3`
- Auth header: `X-TBA-Auth-Key: <TBA_API_KEY>` (server env var only).
- Conditional requests: send `If-None-Match: <etag>`; TBA returns `304 Not Modified` when unchanged.

### 7.2 Endpoints used

| Endpoint | Used for |
|---|---|
| `/event/{key}` | Validate key; name, dates, `event_type` |
| `/event/{key}/teams/simple` | Team pool + nicknames |
| `/event/{key}/matches/simple` | Playoff wins, finals fallback, quals-complete detection, fallback W-L-T |
| `/event/{key}/rankings` | Qual record, RP, rank |
| `/event/{key}/alliances` | Alliance positions, winner/finalist |
| `/event/{key}/awards` | Awards |
| `/event/{key}/oprs` | OPR bonus |
| `/team/frc{n}/events/{year}/simple` | "Add 5181's events" helper |

TBA may return `null` (JSON) or 404 for endpoints with no data yet (e.g. alliances before selection). Both are treated as "no data" (empty), never as an error.

### 7.3 Fetch & cache layer (`lib/tba/client.ts`)

`getTba(path, { windowMs, force = false })` returns `{ data, fetchedAt, stale: boolean }`. The **caller** computes `windowMs` from the round using `cacheWindowFor(round, now)`:

```
local "today" = now in round.timezone
if round.finalized_at is not null           → 24 h
else if today ∈ [start_date − 1 day, end_date + 1 day] → 60 s
else if today > end_date + 1 day            → 10 min   (late-posted offseason results still show up)
else (before the event)                     → 10 min
```

Paths not tied to a round (event validation at round creation, team-events helper) use `windowMs = 10 min`.

1. Read `tba_cache` row for `path`.
2. If a row exists, `force` is false, and `now − fetched_at < windowMs` → return cached.
3. Otherwise request TBA with `If-None-Match` if an etag exists, **5 s timeout**, and `cache: 'no-store'` (§9.2).
   - `200`: upsert body + etag, `fetched_at = now`, clear `last_error`. Return fresh. A JSON `null` body is stored as SQL NULL.
   - `304`: update `fetched_at = now`, clear `last_error`. Return cached body.
   - `404`: store SQL NULL body; upsert; return `data: null`.
   - Timeout / 5xx / network error / 401: record `last_error`, `last_error_at`; if a cached row exists return it with `stale: true`; if not, return `{ data: null, stale: true }`.
4. Concurrent callers may both fetch; accepted at this scale (last write wins; both writes are equivalent).

The **page-level "last updated"** is the minimum `fetched_at` across the paths used to render it; the page shows a stale warning if any path returned `stale: true`.

### 7.4 Ranking points extraction

TBA rankings: `{ rankings: [{ rank, team_key, record: {wins, losses, ties} | null, matches_played, extra_stats: number[], sort_orders: number[] }], extra_stats_info: [{name}], sort_order_info: [{name}] | null }`. The whole response may also be JSON `null`. Treat any missing/null array as empty.

Total RP for a team:
1. If `extra_stats_info` contains an entry whose name, lowercased, contains `"total ranking points"` → use `extra_stats[thatIndex]`.
2. Else if `sort_order_info[0].name` lowercased contains `"ranking score"` or `"ranking points"` (an **average**) → `round(sort_orders[0] × matches_played)`.
3. Else → 0 RP points for everyone, and the round page shows "RP data unavailable for this event".

The chosen method is recorded in the computed result (for display/debugging). Per TBA's backend (`event_details.py`), for years ≥ 2017 "Total Ranking Points" is itself derived as `round(sort_orders[0] × matches_played)`, so branches 1 and 2 agree; `2025parr` takes branch 1, which the fixture test pins.

### 7.5 Match results

A match "has a result" when both `alliances.red.score` and `alliances.blue.score` are `≥ 0` (TBA uses `-1` for unplayed). The winner is `winning_alliance` (`"red"`, `"blue"`, or `""` for no winner).

- **Never override a non-empty `winning_alliance`** by comparing scores: TBA applies game tiebreakers when `score_breakdown` exists, so a lower-or-equal score can legitimately be the winner.
- Fall back to score comparison **only when the field is absent** (not when it is `""`).
- `""` with equal scores means TBA could not determine a winner. Under 2023+ double-elimination rules, playoff ties are **not replayed**; they're decided by tiebreak criteria, which TBA can only apply when a score breakdown exists. Offseasons often lack breakdowns, so a tied playoff match may show `""` even though one alliance advanced. Such matches award no playoff-win points. **Real example:** 2025parr Playoff Match 3 was 156–156 (Alliance 2 vs 7). The commissioner may credit the actual winner with a manual adjustment. *(Update 2026-09-29: TBA has since recorded `blue` as the winner of that match via the game tiebreaker; the engine trusts it, and the fixture test pins that.)*

**Qual W-L-T fallback:** if `rankings` is null/empty or a team's `record` is null, compute W-L-T from qual matches (`comp_level == "qm"`) with results, counting only teams in `team_keys` that are not in `surrogate_team_keys` or `dq_team_keys` for that match.

### 7.6 "Qualifications complete"

Quals are complete when **either**:
- `alliances` data is non-empty (alliance selection happens after quals), **or**
- there is at least one `qm` match, every `qm` match has a result, **and** there is at least one playoff match in the schedule.

Otherwise quals are in progress. (The second rule alone is unreliable because offseason schedules may be posted incrementally; the first rule covers the common case.)

### 7.7 Winner / finalist determination

1. **Primary:** from `/alliances`, an alliance with `status.level == "f"` and `status.status == "won"` is the winner; `status.level == "f"` and `status.status == "eliminated"` is the finalist.
2. **Fallback** (no `status` data), mirroring TBA's own `event_team_status_helper`:
   - For each `comp_level == "f"` match with a result, map **each side** (red, blue) to an alliance: the alliance whose `picks ∪ {backup.in}` shares **≥ 2** teams with that side's `team_keys`.
   - Tally match wins **per alliance**, not per color. Alliance colors are not guaranteed to stay the same across finals matches.
   - The first alliance to 2 finals wins is the winner. The other alliance that appeared in the finals is the finalist.
   - A side that maps to no alliance is ignored.
3. If neither method resolves an alliance, no winner/finalist points are awarded yet.
4. **Awards cross-check:** winner/finalist *awards* (types 1, 2) are always excluded from award scoring (§3.4.5), so there is no double count regardless of which method is used.

### 7.8 Round status

Derived, not stored (except `finalized_at`):

| Status | Condition |
|---|---|
Evaluated top to bottom; first match wins. "Today" is the local date in `rounds.timezone`.

| Status | Condition |
|---|---|
| **Final** | `finalized_at` is set |
| **Setup** | No picks yet |
| **Drafting** | `0 < picks < P × R` |
| **Upcoming** | Draft complete and today < `start_date − 1 day` |
| **Live** | Draft complete and today ∈ [`start_date − 1 day`, `end_date + 1 day`] |
| **Results pending** | Draft complete and today > `end_date + 1 day` |

- **Final comes from the daily auto-finalize job or the commissioner** (spec `2026-10-02-auto-finalize-design.md` §4–5): a TBA round finalizes once TBA shows the finals decided (from the day after `end_date`); any round finalizes 3 days after `end_date`. Reopening a round turns auto-finalize off for that round. *(Amended 2026-10-02; was "Final only ever comes from the commissioner".)*
- Finalizing does **not** freeze scores (scores are always computed from data). It only sets the badge and the 24 h cache window. Reopening clears `finalized_at`, and the round returns to whatever the dates imply.

### 7.9 Scoring engine (`lib/scoring/`)

Pure, synchronous, no I/O. Fully unit-tested.

```ts
type EventData = {
  teams: TeamSimple[] | null;
  matches: MatchSimple[] | null;
  rankings: RankingsResponse | null;
  alliances: Alliance[] | null;
  awards: Award[] | null;
  oprs: { oprs: Record<string, number> } | null;
};

type Line = { category: CategoryId; label: string; quantity?: number; points: number };

type TeamScore = { teamKey: string; total: number; lines: Line[] };

function scoreEvent(data: EventData, config: ScoringConfig):
  { teams: Map<string, TeamScore>; qualsComplete: boolean; rpMethod: 'extra_stats' | 'sort_order_avg' | 'none' };

function scoreRound(
  eventScores: Map<string, TeamScore>,
  picks: Pick[],
  adjustments: Adjustment[],
  playerIds: string[],            // participating players (draft_order)
): PlayerRoundScore[];            // includes per-team breakdown + adjustment lines, sorted, ranked

function seasonStandings(players: Player[], rounds: PlayerRoundScore[][]): SeasonRow[];

function pickerFor(pickNumber: number, order: string[]): string;   // snake formula §3.2
```

- `scoreEvent` returns a `TeamScore` for **every** team appearing in any input (teams list, rankings, matches, alliances, awards, oprs), so undrafted teams can be shown in "the ones that got away".
- Lines with 0 points are omitted from display but kept in the data.
- Team-targeted adjustments are added as lines to that team's score **inside `scoreRound`** (only the owning player receives them).
- Missing input sections (null) contribute 0 for their categories, never throw.

---

## 8. Reliability & error handling

### 8.1 TBA failures

Handled in §7.3: serve last good data, mark stale, show "Scores may be behind — last updated 14 min ago". Never show a blank leaderboard if any cached data exists.

### 8.2 Supabase free-tier pause

Free projects pause after ~7 days of inactivity. Before each event, the commissioner opens the Supabase dashboard and restores if needed. The app catches DB connection errors and shows a friendly "The league database is asleep — the commissioner needs to wake it up" page rather than a stack trace. A pre-event checklist in the README includes this step.

### 8.3 Forced refresh rate limit

`force: true` refreshes are ignored (cached data returned) if the path's `fetched_at` is under 15 s old. Prevents a commissioner button-mash from hammering TBA. Also, after a failed TBA request, the cached row is served as stale for 30 s before TBA is retried (including for forced refreshes), so an outage costs one 5 s timeout per 30 s rather than one per page view.

### 8.4 Input validation

- All mutation bodies are validated with zod; invalid → 400 with a human-readable message.
- Team numbers entered manually: 1–5 digits plus an optional letter suffix (e.g. `341`, `341b`). Leading zeros stripped, suffix uppercased, stored as `frc341B`.
- Event keys: lowercased and trimmed before validation.
- Unique-constraint violations map to specific 409 messages by **constraint name**:
  - `picks_round_team_key` → "That team was just taken"
  - `picks_round_pick_number_key` → "Draft changed in another tab — refresh"
  - `players_league_name_ci` → "There's already a player with that name"
- Pick append must specify `expectedPickNumber`. If it isn't the next number → 409 "Draft changed in another tab — refresh". Same for undo (must specify the pick number being undone).

### 8.5 Display edge cases

- Player with zero picks in a round (participating but draft incomplete): shows 0 with "draft in progress".
- Event with no data yet: round page shows rosters with 0s and "Event hasn't started".
- Long player names: truncate with ellipsis in tables; full name on the player breakdown.

---

## 9. Architecture & tech stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js** (current stable, App Router, TypeScript strict) | Server components for public pages; route handlers for mutations |
| Styling | Tailwind CSS | Mobile-first. Dark mode shipped 2026-09-30 (dark-first with a light toggle; see `design-system/frc-fantasy/OVERHAUL.md`). |
| Database | **Supabase** Postgres (free tier) | Service role key server-only; migrations in `supabase/migrations/` |
| Validation | zod | Shared schemas for API bodies and ScoringConfig |
| Tests | Vitest | Pure scoring engine + TBA client (with mocked fetch) + route handler auth |
| Hosting | **Vercel** Hobby (free, non-commercial) | Env vars: `TBA_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CREATE_LEAGUE_PASSCODE` |

### 9.1 Directory layout

```
frc-fantasy/
  app/
    page.tsx                         # home + create league
    l/[slug]/page.tsx                # league page
    l/[slug]/r/[roundId]/page.tsx    # round page
    l/[slug]/admin/page.tsx          # commissioner dashboard (client shell + token handling)
    l/[slug]/admin/r/[roundId]/page.tsx
    api/leagues/route.ts             # POST create league
    api/l/[slug]/admin/...           # commissioner endpoints (§9.3)
  lib/
    tba/client.ts                    # getTba + cache (§7.3)
    tba/types.ts                     # TBA response types (only fields we use)
    scoring/engine.ts                # scoreEvent (§7.9)
    scoring/round.ts                 # scoreRound, seasonStandings, pickerFor
    scoring/config.ts                # ScoringConfig zod schema + defaults
    db/                              # typed Supabase queries
    auth/commissioner.ts             # token hashing + verification
  scripts/
    capture-fixture.ts               # downloads an event's TBA data into tests/fixtures/<key>/
    rotate-admin-token.ts
  supabase/migrations/
  tests/
    fixtures/2025parr/*.json
    scoring/*.test.ts
    tba/*.test.ts
    api/*.test.ts
  docs/superpowers/specs/
```

### 9.2 Next.js caching — pinned (important)

Next.js's own caches would sit in front of our `tba_cache` and could serve a **build-time snapshot** of the leaderboard or stale TBA bodies all event day. To prevent that:

- **Cache Components is disabled** (not enabled in `next.config`).
- Every page under `app/l/` and every route handler under `app/api/` exports `export const dynamic = 'force-dynamic'`.
- Every `fetch` in `lib/tba/client.ts` passes `cache: 'no-store'`. The Supabase client is also configured with a `no-store` fetch.
- Our own `tba_cache` table (§7.3) is the **only** cache layer.
- Pages and route handlers that call TBA set `export const maxDuration = 30` (seconds). Six parallel TBA calls with 5 s timeouts plus DB queries fit comfortably.
- **Test:** an automated check (or the replay dry run) confirms a leaderboard change appears after refresh without redeploying.

### 9.3 API endpoints

All admin endpoints require the `x-commissioner-key` header (403 otherwise). All bodies are JSON, validated with zod (400 on failure). Responses are JSON.

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/leagues` | `{ name, passcode }` | 201 `{ slug, adminToken }` | 403 bad passcode |
| GET | `/api/l/{slug}/admin/verify` | — | 200 `{ ok: true }` | 403 |
| GET | `/api/l/{slug}/admin/state` | — | 200 league + players + rounds (summary) | 403 |
| PATCH | `/api/l/{slug}/admin/league` | `{ name?, homeTeamNumber?, defaultScoring? }` | 200 | 400, 403 |
| POST | `/api/l/{slug}/admin/players` | `{ name }` | 201 | 409 name exists |
| PATCH | `/api/l/{slug}/admin/players/{id}` | `{ name }` | 200 | 409 name exists |
| DELETE | `/api/l/{slug}/admin/players/{id}` | — | 204 | 409 player in use (§5.4) |
| GET | `/api/l/{slug}/admin/events/{eventKey}` | — (look-up only; adds nothing) | 200 `{ found: false, eventKey }` or `{ found: true, eventKey, name, startDate, endDate, alreadyInLeague }` | 400 malformed key, 403, 503 TBA unreachable |
| POST | `/api/l/{slug}/admin/rounds` | `{ eventKey }` | 201 (event validated on TBA) | 404 unknown event, 409 already in league |
| GET | `/api/l/{slug}/admin/rounds/{id}` | — | 200 round + pool + picks + adjustments | 403, 404 |
| PATCH | `/api/l/{slug}/admin/rounds/{id}` | `{ rosterSize?, draftOrder?, scoring?, finalized? }` | 200 | 409 draft order/roster size changed with picks present; 400 `P × R > T` |
| DELETE | `/api/l/{slug}/admin/rounds/{id}` | — | 204 | — |
| POST | `/api/l/{slug}/admin/rounds/{id}/teams` | `{ teamNumber }` | 201 | 400 bad format |
| DELETE | `/api/l/{slug}/admin/rounds/{id}/teams/{teamKey}` | — | 204 | 409 team is drafted |
| POST | `/api/l/{slug}/admin/rounds/{id}/picks` | `{ expectedPickNumber, teamKey }` | 201 | 409 stale pick number / team taken / draft full; 400 team not in pool |
| DELETE | `/api/l/{slug}/admin/rounds/{id}/picks/{pickNumber}` | — (must be the last pick) | 204 | 409 not the last pick |
| PATCH | `/api/l/{slug}/admin/rounds/{id}/picks/{pickNumber}` | `{ teamKey }` (replace pick) | 200 | 409 team taken; 400 not in pool |
| POST | `/api/l/{slug}/admin/rounds/{id}/adjustments` | `{ playerId? , teamKey?, points, reason }` | 201 | 400 |
| PATCH / DELETE | `/api/l/{slug}/admin/rounds/{id}/adjustments/{adjId}` | partial adjustment / — | 200 / 204 | 404 |
| POST | `/api/l/{slug}/admin/rounds/{id}/refresh` | — | 200 `{ fetchedAt }` | rate-limited → 200 with cached `fetchedAt` |

Every `{id}` is also checked to belong to `{slug}`'s league (404 otherwise), so a valid token for league A can't touch league B.

Public pages read directly from the database in server components; no public API is needed in v1.

### 9.4 Request flow (public round page)

1. Server component loads round, players, picks, adjustments from Supabase.
2. In parallel, `getTba` for teams, matches, rankings, alliances, awards, oprs, with `windowMs = cacheWindowFor(round, now)`.
3. `scoreEvent` → `scoreRound` → render.
4. Client auto-refresh (§5.2) calls `router.refresh()` every 60 s while the tab is visible.

The league page does the same for every round (season standings). Finalized rounds use the 24 h window, so a league page view costs at most 6 TBA requests per non-final round, and usually 6 × 304s.

---

## 10. Testing strategy

1. **Fixture capture:** `scripts/capture-fixture.ts 2025parr` saves every §7.2 endpoint response for Ramp Riot 2025 into `tests/fixtures/2025parr/`. Committed to the repo.
2. **Scoring engine unit tests** against the fixture:
   - Hand-verify full breakdowns for at least 3 teams (the event winner's captain, a mid-ranked team, and an unpicked low-ranked team), with expected values written into the test.
   - Pin: which RP extraction branch `2025parr` uses (expected: branch 1); qualsComplete = true; winner = Alliance 3, finalist = Alliance 4 (via both the `status` path and the finals fallback with `status` stripped); Alliance 2's 4th pick (`picks[3]`) scores the third-pick value; Playoff Match 3 (156–156) credits the tiebreak winner TBA recorded (blue); awards category is 0 (no awards posted); 34 teams in the pool.
3. **Synthetic tests** for edge cases: null sections (including a JSON-`null` rankings body and null `sort_order_info`), ties in OPR (1,1,3) including float near-equality, `winning_alliance` present but disagreeing with scores (must trust the field), surrogate & DQ handling, 4-team alliances with `backup.in`, rank tier boundaries (1, 8, 9, 16, 17), finals where alliance colors swap between matches, awards exclusions (6, 7, 14, 39), B-team keys like `frc341B`, team-targeted adjustment on undrafted team.
4. **Round status & cache window tests:** `cacheWindowFor` and status derivation across timezone boundaries (e.g. 11:30 pm Eastern on `end_date + 1`), finalized vs not, before/during/after the event.
5. **Snake draft tests:** `pickerFor` for P = 1, 2, 3, 5 over several draft rounds.
6. **TBA client tests** (mocked fetch): fresh cache hit, 304, 200 update, JSON-`null` 200 stored as SQL NULL, timeout → stale, 404 → empty, force rate-limit.
7. **API tests:** mutation with missing/wrong token → 403; valid token for league A used on league B's round → 404; removing a player who is in a draft order → 409; pick race → 409; wrong expected pick number → 409; draft-order change with existing picks → 409.
8. **Manual end-to-end dry run (replay):** create a league with the family, add round `2025parr`, run a real draft at dinner, review the leaderboard together. Tune scoring defaults based on the feel.

---

## 11. Timeline to Ramp Riot (Oct 24, 2026)

| Dates | Milestone |
|---|---|
| Sep 30 – Oct 6 | Scaffold Next.js + Supabase + Vercel. TBA client + cache. Capture `2025parr` fixture. Scoring engine with full tests. |
| Oct 7 – Oct 13 | DB schema + migrations. Create league, commissioner auth, players, rounds, draft entry, adjustments. Public league/round pages. |
| Oct 14 – Oct 18 | **Family replay dry run** on `2025parr`. Tune scoring. Mobile polish. Deploy to production URL. |
| Oct 19 – Oct 22 | Priority 2 stretch items only if everything above is done. Feature freeze by Oct 21. Confirm `2026parr` exists on TBA and check its team list; add missing teams manually. Wake Supabase. |
| Oct 23 | Draft night for Ramp Riot 2026. |
| **Oct 24** | **Live.** |

---

## 12. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Ramp Riot 2026 results aren't posted to TBA live | Medium | Stale-data UI; commissioner "refresh"; adjustments as last-resort manual scoring; scores catch up whenever TBA gets data. |
| Ramp Riot 2026 team list missing/incomplete on TBA before the event | Medium-High | Manual team entry (§3.3). |
| TBA event key isn't `2026parr` | Low | Round creation validates key against TBA and shows the event name; commissioner searches TBA for the right key. |
| No awards on TBA for offseason | High | Manual adjustments; documented. |
| Supabase paused on event day | Medium | Pre-event checklist; friendly error page. |
| Scoring feels unbalanced | Medium | Replay dry run before Oct 24; per-round config. |
| Admin link lost | Low | `rotate-admin-token` script. |

---

## 13. v2 backlog (not in this spec's scope)

- Player accounts (Supabase Auth, Google/email magic link) + "claim your player" flow.
- Live draft room using Supabase Realtime (turn timer, auto-pick).
- Projected points / pre-draft team rankings (e.g. from Statbotics EPA when available).
- Notifications ("your team is up next").
- Season awards ("Best Draft", "Biggest Bust").
