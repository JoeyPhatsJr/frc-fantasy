# FRC Fantasy — Design Spec

- **Date:** 2026-09-29
- **Author:** Joey (FRC Team 5181), with Claude
- **Status:** Draft — awaiting review
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
- In v1 the draft happens in real life; the commissioner enters picks in order (§5.4).
- **Player participation:** not every league player must participate in every round. The round's draft order defines who participates. A non-participating player earns 0 round points for that round.

### 3.3 Team pool

- The team pool for a round is TBA's team list for the event (`/event/{key}/teams/simple`).
- **Offseason risk:** offseason team lists may be missing or incomplete on TBA until close to (or after) the event. Therefore the commissioner may **manually add team numbers** to a round's pool. Manually added teams are stored in `round_extra_teams` (§6) and merged with TBA's list (deduplicated by team key).
- A drafted team that never plays (withdrew, no-show) simply earns 0. The commissioner may use **replace pick** (§5.4) to fix it before the event starts.

### 3.4 Scoring

Every scoring value is configurable per round (§3.5). Defaults below. All categories **stack** (e.g. a team can earn captain points *and* winner points).

#### 3.4.1 Qualification results

| Category | Default | Source / rule |
|---|---|---|
| Qual win | 3 per win | `rankings[].record.wins` |
| Qual tie | 1 per tie | `rankings[].record.ties` |
| Qual loss | 0 | — |
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
| Playoff match win | 4 per win | For each match with `comp_level ≠ "qm"` that has a result (§7.5) and a winning alliance, every team in that alliance's `team_keys` for that match earns the points. Teams in `surrogate_team_keys` or `dq_team_keys` for that match do not. Tied playoff matches award nothing (they are replayed). |
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
| Woodie Flowers (3), Dean's List (4), Volunteer (5) | **excluded** — individual awards |
| Any other award with a team recipient | 5 |

- The `award_type` numeric enum must be checked against TBA's published constants during implementation (the fixture test in §10 pins the mapping).
- **Offseason note:** Ramp Riot 2025 had **no awards on TBA**. Awards are therefore commonly scored via **manual adjustments** (§3.7) at offseasons. If TBA returns no awards, the awards category is simply 0.

#### 3.4.6 Stats bonus (OPR)

- After qualifications are complete (§7.6), teams are ranked by TBA OPR at this event (`/event/{key}/oprs` → `oprs[teamKey]`).
- Default bonus: OPR rank #1 → **+6**, #2 → **+4**, #3 → **+2**.
- **Ties:** standard competition ranking ("1,1,3"): tied teams share the better place and the next place is skipped.
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
- The token lives in the URL **fragment** (`#k=…`) so it is never sent to servers in request lines or logged by hosts/proxies. The admin page's client code reads the fragment, stores the token in `localStorage` under `frcf:admin:{slug}` (so revisiting `/l/{slug}/admin` without the fragment works on that device), and sends it on every mutation as the `x-commissioner-key` header.
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
- **Rounds list**: each round with event name, dates, status badge (Setup / Drafting / Live / Final — §7.8), and link to the round page.
- If a round is Live, it is pinned at the top with its current leaderboard.
- "Last updated X min ago" for live data; stale warning if the TBA fetch failed (§8).
- Auto-refresh every 60 s while any round is Live and the tab is visible.

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
- **Undrafted notable teams**: the top 5 scoring undrafted teams ("the ones that got away") — cheap to compute, big trash-talk value.

### 5.4 `/l/{slug}/admin` — Commissioner dashboard

Requires a valid token (fragment or localStorage). If none or invalid: "This admin link is invalid" and nothing else.

**League section**
- Rename league.
- Players: add, rename, remove. A player who has picks or adjustments in any round cannot be removed (UI explains why); they can be renamed.
- Edit league default scoring config (form with all fields from §6.2, with "reset to defaults").

**Rounds section**
- **Add round** by event key (validated against TBA `/event/{key}`; shows event name/dates for confirmation).
- **"Add 5181's events"** helper: calls TBA `/team/frc5181/events/{year}/simple` for the current year and lists events not already in the league, each with an "add" button. The team number is configurable in league settings (default 5181).
- Delete round (confirmation dialog; deletes its picks and adjustments).

### 5.5 `/l/{slug}/admin/r/{roundId}` — Round admin

- **Setup**: roster size, participating players & draft order (drag to reorder, or "randomize"), team pool (TBA list + manually added teams with "add team number" input), scoring config for this round.
- **Draft entry**:
  - Banner: "Pick 7 of 20 — Mom's turn (round 2)".
  - Search box filtering available teams by number or nickname; tapping a team records the pick for the current picker immediately (no confirm dialog — speed matters at the dinner table).
  - **Undo last pick**.
  - **Replace pick**: change which team a past pick refers to (must be an available team). Does not change pick order.
  - Draft board preview.
- **Adjustments**: add/edit/delete (§3.7).
- **Refresh from TBA** button (forces a cache refresh; rate-limited, §8.3).
- **Mark round final** / reopen (§7.8).

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
  created_at  timestamptz not null default now(),
  unique (league_id, name)
);

create table rounds (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references leagues(id) on delete cascade,
  event_key     text not null check (event_key ~ '^[0-9]{4}[a-z0-9]+$'),
  event_name    text not null,                 -- cached from TBA at creation
  start_date    date,
  end_date      date,
  roster_size   integer not null default 4 check (roster_size between 1 and 10),
  draft_order   uuid[] not null default '{}',  -- player ids, participating players only
  scoring       jsonb not null,                -- ScoringConfig copied from league at creation
  finalized_at  timestamptz,                   -- null = not final (§7.8)
  created_at    timestamptz not null default now(),
  unique (league_id, event_key)
);

create table round_extra_teams (
  round_id  uuid not null references rounds(id) on delete cascade,
  team_key  text not null check (team_key ~ '^frc[0-9]{1,5}$'),
  primary key (round_id, team_key)
);

create table picks (
  id           uuid primary key default gen_random_uuid(),
  round_id     uuid not null references rounds(id) on delete cascade,
  pick_number  integer not null check (pick_number >= 0),   -- 0-indexed overall pick
  player_id    uuid not null references players(id) on delete restrict,
  team_key     text not null check (team_key ~ '^frc[0-9]{1,5}$'),
  created_at   timestamptz not null default now(),
  unique (round_id, pick_number),
  unique (round_id, team_key)
);

create table adjustments (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references rounds(id) on delete cascade,
  player_id   uuid references players(id) on delete restrict,
  team_key    text check (team_key ~ '^frc[0-9]{1,5}$'),
  points      integer not null check (points between -1000 and 1000),
  reason      text not null check (char_length(reason) between 1 and 200),
  created_at  timestamptz not null default now(),
  check ((player_id is null) <> (team_key is null))          -- exactly one target
);

create table tba_cache (
  path        text primary key,          -- e.g. '/event/2025parr/matches/simple'
  etag        text,
  body        jsonb not null,
  fetched_at  timestamptz not null,      -- last time we successfully talked to TBA (200 or 304)
  last_error  text,                      -- last failure message, null if last attempt succeeded
  last_error_at timestamptz
);
```

**Integrity rules enforced in application code (not expressible as simple constraints):**
- Every `rounds.draft_order` element must be a player of the same league, with no duplicates.
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
    "excludedTypes": [1, 2, 3, 4, 5],
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

`getTba(path, { force = false })` returns `{ data, fetchedAt, stale: boolean }`:

1. Read `tba_cache` row for `path`.
2. Freshness window: **60 s** if the event is current (today within `[start_date − 1 day, end_date + 1 day]`, using the event's `timezone` from `/event/{key}`; if unknown, US Eastern), otherwise **24 h**.
3. If a row exists, `force` is false, and `now − fetched_at < window` → return cached.
4. Otherwise request TBA with `If-None-Match` if an etag exists, **5 s timeout**.
   - `200`: upsert body + etag, `fetched_at = now`, clear `last_error`. Return fresh.
   - `304`: update `fetched_at = now`, clear `last_error`. Return cached body.
   - `404`: treat as empty (`null`) body; upsert; return.
   - Timeout / 5xx / network error / 401: record `last_error`, `last_error_at`; if a cached row exists return it with `stale: true`; if not, return `{ data: null, stale: true }`.
5. Concurrent callers may both fetch; accepted at this scale (last write wins; both writes are equivalent).

The **page-level "last updated"** is the minimum `fetched_at` across the paths used to render it; the page shows a stale warning if any path returned `stale: true`.

### 7.4 Ranking points extraction

TBA rankings: `{ rankings: [{ rank, team_key, record: {wins, losses, ties} | null, matches_played, extra_stats: number[], sort_orders: number[] }], extra_stats_info: [{name}], sort_order_info: [{name}] }`.

Total RP for a team:
1. If `extra_stats_info` contains an entry whose name, lowercased, contains `"total ranking points"` → use `extra_stats[thatIndex]`.
2. Else if `sort_order_info[0].name` lowercased contains `"ranking score"` or `"ranking points"` (an **average**) → `round(sort_orders[0] × matches_played)`.
3. Else → 0 RP points for everyone, and the round page shows "RP data unavailable for this event".

The chosen method is recorded in the computed result (for display/debugging). The `2025parr` fixture test pins which branch that event takes.

### 7.5 Match results

A match "has a result" when both `alliances.red.score` and `alliances.blue.score` are `≥ 0` (TBA uses `-1` for unplayed). The winner is `winning_alliance` (`"red"`, `"blue"`, or `""` for tie). If `winning_alliance` is missing but scores exist, winner = higher score; equal = tie.

**Qual W-L-T fallback:** if `rankings` is null/empty or a team's `record` is null, compute W-L-T from qual matches (`comp_level == "qm"`) with results, counting only teams in `team_keys` that are not in `surrogate_team_keys` or `dq_team_keys` for that match.

### 7.6 "Qualifications complete"

Quals are complete when **either**:
- `alliances` data is non-empty (alliance selection happens after quals), **or**
- there is at least one `qm` match, every `qm` match has a result, **and** there is at least one playoff match in the schedule.

Otherwise quals are in progress. (The second rule alone is unreliable because offseason schedules may be posted incrementally; the first rule covers the common case.)

### 7.7 Winner / finalist determination

1. **Primary:** from `/alliances`, an alliance with `status.level == "f"` and `status.status == "won"` is the winner; `status.level == "f"` and `status.status == "eliminated"` is the finalist.
2. **Fallback** (no `status` data): among `comp_level == "f"` matches with results, count wins per side. The first side to reach 2 wins is the winner. Map that side to an alliance by finding the alliance whose `picks ∪ {backup.in}` contains the **majority** of that side's `team_keys` in the deciding match. The other finals alliance (same method on the opposing side) is the finalist.
3. If neither method resolves an alliance, no winner/finalist points are awarded yet.
4. **Awards cross-check:** winner/finalist *awards* (types 1, 2) are always excluded from award scoring (§3.4.5), so there is no double count regardless of which method is used.

### 7.8 Round status

Derived, not stored (except `finalized_at`):

| Status | Condition |
|---|---|
| **Setup** | No picks yet |
| **Drafting** | `0 < picks < P × R` |
| **Live** | Draft complete, not finalized, and today ≤ `end_date + 1 day` |
| **Final** | `finalized_at` is set, **or** draft complete and today > `end_date + 1 day` |

Finalizing does **not** freeze scores (scores are always computed from data). It only affects the badge and switches the cache freshness window to 24 h. Reopening clears `finalized_at`.

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

`force: true` refreshes are ignored (cached data returned) if the path's `fetched_at` is under 15 s old. Prevents a commissioner button-mash from hammering TBA.

### 8.4 Input validation

- All mutation bodies are validated with zod; invalid → 400 with a human-readable message.
- Team numbers entered manually: 1–5 digits, stored as `frc<number>` with leading zeros stripped.
- Event keys: lowercased and trimmed before validation.
- Unique-violation on `picks.team_key` (race: two tabs) → 409 "That team was just taken".
- Pick append must specify the expected `pick_number`; if it isn't the next number → 409 "Draft changed in another tab — refresh". Same for undo (must specify the pick number being undone).

### 8.5 Display edge cases

- Player with zero picks in a round (participating but draft incomplete): shows 0 with "draft in progress".
- Event with no data yet: round page shows rosters with 0s and "Event hasn't started".
- Long player names: truncate with ellipsis in tables; full name on the player breakdown.

---

## 9. Architecture & tech stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js** (current stable, App Router, TypeScript strict) | Server components for public pages; route handlers for mutations |
| Styling | Tailwind CSS | Mobile-first; supports dark mode via `prefers-color-scheme` |
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
    api/l/[slug]/...                 # commissioner mutations (players, rounds, picks, adjustments, scoring, refresh)
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

### 9.2 Request flow (public round page)

1. Server component loads round, players, picks, adjustments from Supabase.
2. In parallel, `getTba` for teams, matches, rankings, alliances, awards, oprs.
3. `scoreEvent` → `scoreRound` → render.
4. Client auto-refresh (§5.2) calls `router.refresh()` every 60 s while Live and visible.

The league page does the same for every round (season standings). Past rounds hit the 24 h cache window, so a league page view costs at most 6 TBA requests per live round.

---

## 10. Testing strategy

1. **Fixture capture:** `scripts/capture-fixture.ts 2025parr` saves every §7.2 endpoint response for Ramp Riot 2025 into `tests/fixtures/2025parr/`. Committed to the repo.
2. **Scoring engine unit tests** against the fixture:
   - Hand-verify full breakdowns for at least 3 teams (the event winner's captain, a mid-ranked team, and an unpicked low-ranked team), with expected values written into the test.
   - Pin: which RP extraction branch `2025parr` uses; qualsComplete = true; winner/finalist alliances.
3. **Synthetic tests** for edge cases: null sections, ties in OPR (1,1,3), tied playoff match, surrogate & DQ handling, 4-team alliances with `backup.in`, rank tier boundaries (1, 8, 9, 16, 17), missing `status` → finals fallback, awards exclusions, team-targeted adjustment on undrafted team.
4. **Snake draft tests:** `pickerFor` for P = 1, 2, 3, 5 over several draft rounds.
5. **TBA client tests** (mocked fetch): fresh cache hit, 304, 200 update, timeout → stale, 404 → empty, force rate-limit.
6. **API tests:** mutation with missing/wrong token → 403; pick race → 409; wrong expected pick number → 409; draft-order change with existing picks → 409.
7. **Manual end-to-end dry run (replay):** create a league with the family, add round `2025parr`, run a real draft at dinner, review the leaderboard together. Tune scoring defaults based on the feel.

---

## 11. Timeline to Ramp Riot (Oct 24, 2026)

| Dates | Milestone |
|---|---|
| Sep 30 – Oct 6 | Scaffold Next.js + Supabase + Vercel. TBA client + cache. Capture `2025parr` fixture. Scoring engine with full tests. |
| Oct 7 – Oct 13 | DB schema + migrations. Create league, commissioner auth, players, rounds, draft entry, adjustments. Public league/round pages. |
| Oct 14 – Oct 18 | **Family replay dry run** on `2025parr`. Tune scoring. Mobile polish. Deploy to production URL. |
| Oct 19 – Oct 22 | Feature freeze. Confirm `2026parr` exists on TBA and check its team list; add missing teams manually. Wake Supabase. |
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
