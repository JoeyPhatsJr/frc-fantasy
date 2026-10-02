# FRC Fantasy — UX overhaul design

**Date:** 2026-10-01 · **Status:** approved in brainstorming (Joey, 2026-10-01 20:23–22:15) · **Branch:** `ux-overhaul`

Builds on the v1 spec (`2026-09-29-frc-fantasy-design.md`), the v2 spec (`2026-09-30-frc-fantasy-v2-design.md`) and the UI overhaul brief (`design-system/frc-fantasy/OVERHAUL.md`). Where this document disagrees with those on **navigation, layout, visual style or copy**, this document wins. It changes **no** rules, scoring, schema, API, caching or draft logic.

## 1. Why

Joey, after v2 went live: the player screens are *"clunky, vibecoded, and confusing."* In brainstorming he confirmed all four problems:

1. **Hard to find your way.** Inside a league the Me/Leagues tabs vanish and the only way out is the logo. The draft room is only reachable from a banner while a draft is running. Settings is only reachable from the header avatar.
2. **Too much on screen.** The round page shows the same data three times (Leaderboard, Rosters, Draft board). Season standings show bare per-round numbers explained by a footnote.
3. **Unclear next step.** The round page and round admin look the same in every status. Nothing says "draft starts…" or "go to the draft room".
4. **Looks generic / AI-made.** Cards inside cards everywhere. The light theme uses Tailwind's stock palette (`#eff6ff` page, `#2563eb` blue). Bumper plates alternate red/blue for no reason.

**Audience:** Joey's family and friends — many are not FRC people — on phones, in a loud gym, on draft night and event day. **Deadline:** feature freeze Oct 21, draft night Oct 23, Ramp Riot Oct 24.

**Success:** a first-time family member can, without help: open the app, see what to do next, get into the draft room, draft, find their score during the event, and get back home — and the app looks like an FRC app, not a template.

## 2. Decisions (locked in brainstorming)

| # | Question | Choice |
|---|---|---|
| D1 | Order of tabled work | UX overhaul first, auto-finalize after (separate spec) |
| D2 | Scope | Every screen, admin included |
| D3 | Navigation | **Bottom bar never leaves** (Home · Leagues · You); league tabs sit at the top |
| D4 | Home | **"Up next" card + your leagues** |
| D5 | Event tab | **One leaderboard, tap a player to expand** their teams; draft board moves to the Draft tab |
| D6 | Visual style | **Broadcast scoreboard**: dark header band, flat rows with hairline dividers, warm concrete light theme, big condensed numerals |
| D7 | Round admin | **Numbered checklist** (Set up → Run the draft → During the event → Wrap up) |
| D8 | Rollout | **Layer by layer** on one branch, one PR |
| D9 | Forgot-password copy | Refers to "the league commissioner", not a name |

Mockups from the session are in `.superpowers/brainstorm/` (gitignored, local only).

## 3. Non-goals

- No schema, migration, API route, scoring, caching, TBA, or draft-engine changes. `lib/draft/*`, `lib/scoring/*`, `lib/tba/*`, `lib/db/*`, `app/api/**` and `components/draft/useDraftRoom.ts` are **read-only** for this project (except adding read-only helper queries in `lib/views/*` built from existing repo methods).
- No scheduled draft time (the app doesn't store one; Home shows the event date instead).
- No push notifications, no new auth flows.
- Auto-finalize is the next project, not this one. Round admin's "Wrap up" step keeps today's manual Mark final / Reopen.

## 4. Visual system (Phase 1)

### 4.1 Tokens

Tokens stay in `app/globals.css` (Tailwind 4 `@theme`; dark values are the defaults, light under `:root[data-theme="light"]`, light is the default theme — unchanged mechanics). Names stay the same so existing utilities keep working; **values** change, and three tokens are added: `band`, `on-band`, `band-muted` (the dark broadcast header band, used in both themes).

Starting values (the implementer may nudge them to pass §4.5 contrast tests, keeping the character):

| Token | Light | Dark | Role |
|---|---|---|---|
| `bg` | `#f4f2ee` | `#0d131d` | page — warm concrete / de-saturated field navy |
| `surface` | `#ffffff` | `#151d2a` | raised rows (your row, expanded rows), sheets, inputs |
| `surface-2` | `#ebe8e2` | `#1c2636` | pressed rows, skeletons, secondary fills |
| `border` | `#dcd8d0` | `#283447` | hairline dividers |
| `fg` | `#16181d` | `#eef2f7` | text |
| `fg-muted` | `#5f5b53` | `#9ba8ba` | secondary text |
| `band` | `#14171f` | `#080b11` | header band behind league name + tabs |
| `on-band` | `#ffffff` | `#ffffff` | text on band |
| `band-muted` | `#9aa3b5` | `#8592a8` | inactive tab text on band |
| `primary` | `#0a52b0` | `#6aa2ff` | FRC blue as text / links |
| `primary-fill` | `#0a5bc4` | `#2f6fe0` | blue buttons, blue bumpers |
| `primary-strong` | `#08489c` | `#255ac0` | pressed |
| `red-alliance` | `#d0261d` | `#de2f28` | red bumpers, danger fills |
| `red-alliance-text` | `#b3201a` | `#ff7a72` | danger text |
| `accent` | `#f2a900` | `#f5b301` | gold: leader, current step, active tab underline |
| `accent-text` | `#8a5a00` | `#ffd35c` | gold as text |
| `success` | `#127a3a` | `#2fbf71` | LIVE badge, saved |
| `warning` | `#9a5b00` | `#ffd35c` | stale data |
| `secondary` | `#6d3fd1` | `#9b7bff` | commissioner label only |

`on-*` companions, `ring`, `silver`, `bronze` are kept and re-tuned to match. `radius-card` drops to 10px (sheets/forms only); `shadow-card` is removed from rows (kept only for sheets).

### 4.2 Color has meaning

- **Blue** = you / your teams / primary actions. Bumper plates are **always blue** unless a match context says the team is on red (no alternating by index).
- **Red** = danger, or real red-alliance context. Never decoration.
- **Gold** = the leader (#1 rank numeral), the current admin step, the active tab underline, the live-draft pill.
- **Green** = live.
- **Purple** = the "Commissioner" label only (no longer the Setup/Drafting badge tone; those use neutral).

### 4.3 Layout rules

- **Rows, not cards.** Lists are full-width rows separated by `border` hairlines on `bg`. "Your" row and expanded rows sit on `surface` with a 4px `primary-fill` inset bar on the left.
- **Cards survive only** for forms, sheets and the Home "Up next" hero.
- **Section headers** are small uppercase letter-spaced labels (`fg-muted`, 11px, `tracking-[.12em]`), not card titles.
- Content column max width 42rem, centered; 16px side gutter; works at 360px with no horizontal scroll. Tap targets ≥ 44px.

### 4.4 Type

Barlow Condensed (display) for numerals, names, headers, tab labels; Barlow (body) for everything else — unchanged fonts. Scores use big tabular condensed numerals (26px in leaderboards). Rank is a condensed numeral (gold for 1st, `silver` 2nd, `bronze` 3rd, `fg-muted` otherwise) — the colored rank circles go away.

### 4.5 Contrast test

A new unit test reads `app/globals.css`, extracts each theme's token values, and asserts WCAG AA (≥ 4.5:1) for: `fg`/`bg`, `fg`/`surface`, `fg-muted`/`bg`, `fg-muted`/`surface`, `primary`/`bg`, `primary`/`surface`, `on-primary`/`primary-fill`, `on-band`/`band`, `band-muted`/`band`, `accent-text`/`bg`, `on-accent`/`accent`, `red-alliance-text`/`bg`, `on-success`/`success`.

### 4.6 Primitives (`components/ui/`)

Rebuilt or added; every screen is built only from these plus feature components:

| Primitive | Purpose |
|---|---|
| `Button` | variants `primary` (blue), `accent` (gold), `secondary` (outline), `ghost`, `danger`; sizes `md` (44px) / `sm` |
| `Row` | a list row: optional leading slot (rank/plate/step number), title + subtitle, trailing slot (points/chevron), `href` or `onClick`, `highlight` (your row), `expandable` with `expanded` content |
| `Section` | uppercase label header + optional action link + children (rows) |
| `StatusStrip` | the per-page status line: tone (`neutral`/`live`/`final`/`drafting`/`warning`), title, detail, optional action, optional switcher slot |
| `Tabs` | top tab row on the band (league tabs) and in-page tabs (draft room); `aria-current`, keyboard support |
| `Sheet` | bottom sheet / dialog (existing ConfirmSheet/TeamSheet patterns unified) |
| `BumperPlate` | unchanged API; default color blue |
| `Info` | ⓘ button that opens a one-line explainer for a glossary term |
| `Badge`, `Input`, `Select`, `Alert` | restyled to the new tokens; `Card` kept for forms only |

### 4.7 Glossary (`lib/glossary.ts`)

One map of term → `{ label, short }`, used by `Info` and by every stat label so wording is identical everywhere:

| Key | Label | Short explainer |
|---|---|---|
| `opr` | Robot rating (OPR) | How many points a robot adds to its alliance's score, from The Blue Alliance. |
| `proj` | Projected | Points we expect this team to earn at this event. |
| `rp` | Ranking points | Points teams earn in qualification matches; they decide the rankings. |
| `quals` | Qualification matches | The first part of an event. Every team plays several random matches. |
| `playoffs` | Playoffs | The elimination bracket after alliance selection. |
| `alliance` | Alliance selection | Top-ranked teams pick partners for the playoffs. |
| `queue` | Your queue | Teams you want, in order. If you're on auto-draft or your timer runs out, we pick the top one still available. |
| `autodraft` | Auto-draft | We pick for you each turn: the top of your queue, or the best team left. |
| `snake` | Snake order | Pick order reverses every round: 1→6, then 6→1. |
| `pool` | Team pool | The teams that can be drafted for this event. |
| `adjust` | Adjustments | Points the commissioner added or removed by hand, with a reason. |
| `eventcode` | Event code | The Blue Alliance's ID for an event, like 2025parr. |
| `commish` | Commissioner | The person who runs the league. |

Wording of `queue`/`autodraft`/`snake`/`proj` must match what the draft engine and pool stats actually do — the implementer verifies against `lib/draft/*` and `lib/pool/*` before finalizing copy and corrects the table if needed.

## 5. Shell and navigation (Phase 2)

### 5.1 Routes

| Route | Today | New |
|---|---|---|
| `/` | Me (signed in) / Landing | **Home** (signed in) / Landing — unchanged split |
| `/leagues` | Leagues | Leagues (manage list + create + join) |
| `/you` | — | **New.** Profile, My season, Appearance, Sign out, Delete account. Signed-out → redirect `/signin?next=/you` |
| `/me/settings` | Settings | **Redirect** → `/you` (keep the route file as a redirect so old links work) |
| `/l/[slug]` | Standings | Standings (event-by-event) / **season view** (full-season, §6.4) |
| `/l/[slug]/r/[roundId]` | Round | Event tab content |
| `/l/[slug]/draft` | — | **New.** Server redirect to `/l/[slug]/r/{target}/draft` using `targetRound` (`lib/rounds/target.ts`); no rounds → empty state |
| `/l/[slug]/r/[roundId]/draft` | Draft room (live only) | Draft tab content for **both** draft modes (§6.6) |
| `/l/[slug]/admin`, `/l/[slug]/admin/r/[roundId]` | Admin | Admin (§7) |
| `/join/[code]`, `/signin`, `/leagues/new` | — | restyled + copy (§6.8–6.10) |

### 5.2 Bottom bar (`BottomBar`)

Signed-in users see it on **every** page: **Home** `/` · **Leagues** `/leagues` · **You** `/you`. Active state: Home on `/`; Leagues on `/leagues*`, `/join/*` **and every `/l/*` page**; You on `/you`. Signed-out users get no bottom bar. It replaces `AppTabBar` and `TabBar`'s phone mode.

### 5.3 App header

- **Outside a league:** slim band header — hex-nut logo + "FRC FANTASY" (links `/`). Signed out: a "Sign in" button on the right. Signed in: nothing on the right (the avatar `HeaderAccount` and the header `ThemeToggle` go away; theme moves to You).
- **Inside a league (`LeagueHeader`):** the band holds the league name, a **Switch ▾** chip (signed-in members with >1 league; opens a `Sheet` listing their leagues), a **⋯** menu (members: "Your name in this league", "Copy league link", "Leave league" — the actions from today's `LeagueMeCard`), the Commissioner label if applicable, and the **league tabs**:
  - Event-by-event: **Standings · Event · Draft · Admin**
  - Full-season: **Standings · Draft · Admin** (§6.4)
  - Admin only for commissioners. Event tab → `/l/slug/r/{targetRound}`; when the league has no rounds the tab still shows and renders the empty state. Draft tab → `/l/slug/draft`.
  - Active tab: white label + 3px `accent` underline.

### 5.4 `lib/nav.ts`

Rewritten as pure functions with unit tests:

```ts
export type AppTab = 'home' | 'leagues' | 'you';
export function appTab(pathname: string): AppTab | null;          // §5.2 rules
export type LeagueTab = 'standings' | 'event' | 'draft' | 'admin';
export function leagueTab(pathname: string, slug: string): LeagueTab | null;
//  /l/s → standings · /l/s/r/x → event · /l/s/r/x/draft and /l/s/draft → draft · /l/s/admin* → admin
export function leagueTabs(format: LeagueFormat, isCommissioner: boolean): LeagueTab[];
export function showLiveDraftPill(pathname: string): boolean;     // false on any /draft page
```

`showAppTabBar` is deleted (the bar is always shown when signed in).

### 5.5 Live-draft pill

When the signed-in user is a member of any league with a draft in phase `live` or `paused`, a gold pill sits just above the bottom bar on every page except draft pages: **"● Draft is live — {league} · Join"** (paused: "Draft paused — {league}"; when `onClockPlayer` (`lib/draft/live.ts`) is the user: **"● Your pick! — {league}"**), linking to that round's draft room. More than one → the first by league name, with "+1".

Data: a new `loadMyLiveDrafts(userId)` in `lib/views/` that uses **only existing repo methods** (the user's leagues → their rounds → picks for rounds still drafting) and `liveDraftsOf` from `lib/draft/liveBanner.ts`. It must not call TBA or `loadLeaguePage`. Rendered from the root layout; failures render nothing (never block the page). It replaces the per-page `LiveDraftBanner` on Standings/Event.

## 6. Player screens (Phase 3)

### 6.1 Home `/` (signed in)

1. **Up next** — one hero card (the only card on the page), picked by `upNext()` (§8.1) across all the user's leagues:

| Kind | Title | Detail | Action |
|---|---|---|---|
| `draft-live` | "Your pick!" if on the clock, else "Draft is live" (paused: "Draft paused") | "{event} · {league}" | **Open draft room** (accent) |
| `event-live` | "You're {ordinal} at {event}" (no picks: "{event} is live") | "{points} pts · {league}" | **See scores** |
| `results` | "You finished {ordinal} at {event}" + 🥇/🥈/🥉 for top 3 | "{winner} won · {league}" | **See results** |
| `event-soon` | "{event} starts {Mon D}" | "Your teams: 5181, 2539, …" (plates) | **See your teams** |
| `draft-soon` | "{event} draft coming up" | "{Mon D} · {league}" | **Open draft room** |
| none | "Nothing on right now" | "Your next event will show up here." | — |

2. **Your leagues** — `Section` of `Row`s: league name, one-line status from that league's most relevant round ("Ramp Riot · drafting", "2026 season · 4 events left", "No events yet"), trailing rank `#2` (or `—`). Commissioner label inline. Error rows say "Couldn't load" (as today).
3. Zero leagues: the hero becomes "Welcome! Join your family's league with the invite code, or start one." with the invite-code box and **Create a league**.

"My season" stats move to You. The team list (`MeTeam`) is dropped from Home (your teams appear in the Up next detail and on the Event tab). `AutoRefresh` runs on Home only while an `event-live` or `draft-live` card is showing.

### 6.2 Leagues `/leagues`

The same league `Row`s as Home (shared `LeagueRows` component), then **Create a league** (primary button) and **Join with a code** (the invite-code box). Copy: "Create a league" everywhere (not "Create league").

### 6.3 Standings `/l/[slug]` (event-by-event leagues)

1. `StatusStrip`: "{n} events · {k} to go" (or "Season over" when all final; "No events yet" when none).
2. **Season leaderboard** — `Row` per player: rank numeral, name ("(you)" suffix + highlight for the viewer), total (26px). Each row **expands** to a per-event breakdown: one line per round, "{event name} · {points}" (+ "Final"/"Live" tag), replacing today's bare space-separated numbers and footnote.
3. **Events** — `Row` per round, date order: date block, event name, status badge, and the viewer's rank at that event when drafted ("You: 2nd"). Links to `/l/slug/r/id`.
4. Empty states: "No players yet — share the invite code from Admin." (commissioners get a link) / "No events yet." + commissioner link "Add one in Admin".

Removed from Standings: the per-live-round "Live now" leaderboards (Up next + Event tab cover it), `LeagueMeCard` (moved to the ⋯ menu), `LiveDraftBanner` (pill).

### 6.4 Full-season leagues

Tabs are **Standings · Draft · Admin**. `/l/slug` renders the **current season round** with the Event-tab layout (§6.5) in season mode: rows expand player → events → teams (today's `RosterList` season nesting, restyled), plus an **Events** section listing the season calendar (date, event, status). A **season switcher** in the `StatusStrip` ("2026 season ▾") lists past seasons, linking to `/l/slug/r/{id}`. "Current season" = `targetRound` over the league's season rounds.

### 6.5 Event `/l/[slug]/r/[roundId]`

1. `StatusStrip` by status, holding the **event switcher** ("{event} ▾", a `Sheet` listing the league's rounds) and freshness:

| Status | Tone | Title | Detail / action |
|---|---|---|---|
| setup | neutral | "Draft not set up yet" | "{dates}" |
| drafting | drafting | "Draft in progress" | **Open draft room** |
| upcoming | neutral | "Starts {Mon D}" | "{dates}" |
| live | live (green ● LIVE) | "{event}" | "updated {ago}" (from `freshnessText`) |
| awaiting_final | final | "Event over · results may still change" | "updated {ago}" |
| final | final | "Final · {winner} wins" | — |

2. **Leaderboard** — `Row` per player with rank, name, points; **expandable**; the viewer's row is expanded by default. Expanded content = that player's teams, one line each: plate, plain stats from today's roster lines (e.g. "6–2 · rank 4"), points. Lines use `lineText`/existing breakdown data — no new scoring. Setup/drafting: the list shows players with "—" and expanded rows show picks so far. Season rounds nest events (§6.4).
3. **Notes** — today's three alerts ("Event hasn't started", "OPR bonus: after quals", "RP data unavailable") become one-line muted notes under the strip, using glossary labels; plus a **How scoring works** link opening a `Sheet` that summarizes the round's scoring config in plain words.
4. **Adjustments** — shown only when the round has any.
5. External link "View on The Blue Alliance" moves into the event switcher sheet.

Removed: separate Rosters section, Draft board (→ Draft tab), "‹ Standings" back link, `LiveDraftBanner`.

### 6.6 Draft `/l/[slug]/r/[roundId]/draft`

- **`draftMode === 'live'`** → the draft room for every phase:
  - **setup:** banner "Draft hasn't started" + "You pick {ordinal} of {n}" + snake explainer (`Info snake`); tabs Pool · My queue · Board so players can queue early.
  - **live/paused:** sticky `DraftRoomBanner` — "On the clock: {name} · 0:42" / **"Your pick!"** / "You're up in {n} picks" / "Paused by the commissioner".
  - **done:** banner "Draft complete"; default tab Board.
  - **Auto-draft** is a visible switch in the banner area with the glossary one-liner (replaces the collapsed "Draft options").
  - **Commissioner strip** (commissioners only), always visible under the banner: Pause / Resume / Undo last pick.
  - Tabs: **Pool · My queue ({n}) · Board**. The Rosters tab is removed (Board shows each player's column). Watchers: Pool · Board, plus "You're watching — only league members can draft."
  - Pool rows: plate, team name, "Projected 52 · Robot rating 38" (glossary labels), queue toggle, Draft button. Sort labels: "Projected", "Robot rating", "Team number".
- **`draftMode === 'commissioner'`** → the **draft board** (`DraftBoard`) with the strip "The commissioner enters picks for this event" (done: "Draft complete"). Replaces "No live draft for this round".
- No back link (tabs cover it). Logic untouched: `useDraftRoom`, `ConfirmSheet` behavior, pick APIs.

### 6.7 You `/you`

Sections: **Profile** (Display name, My FRC team — today's `SettingsForm` fields) · **My season** (labeled: "{total} points in {year}", "Best pick: {team} at {event} (+{pts})", "Average finish: {n}" — from `seasonSummary`) · **Appearance** (Light / Dark segmented control, replacing the header toggle) · **Account** (Sign out; Delete account visually separated at the bottom, `danger`).

### 6.8 Join `/join/[code]`

Card: "You're invited to **{league}**", then a plain line describing it — event-by-event: "Event by event · next up {event}, {Mon D}" (or "No events yet"); full-season: "Full {year} season" — then "Run by {commissioner} · {n} players", then Join (or inline sign-up when signed out, as today). Error states unchanged in logic, restyled.

### 6.9 Sign in `/signin`

Restyled. Forgot-password line: **"Forgot your password? Ask the league commissioner to reset it."**

### 6.10 Create a league `/leagues/new`

Same fields and API. Plain helper text under each choice:
- Visibility: "Anyone with the link can watch" / "Only members can see it".
- Event by event: "Draft new teams for each event." Follow teams: "Follow up to 3 teams and we'll add each event they attend automatically."
- Full season: "Draft once and score every official event all year."
After create, land on `/l/slug/admin` (as today) — which now opens with **Invite people** (§7.1).

### 6.11 Landing `/` (signed out)

Same story and sections (hero, match lineup, sample scoreboard, how it works, coming up), restyled to the new system. Adds a visible **Sign in** button beside "Create an account". `SampleScoreboard` uses the new leaderboard rows.

## 7. Admin (Phase 4)

`AdminGate` behavior is unchanged. All forms keep their existing API calls (`useAdmin`, `usePending`).

### 7.1 League admin `/l/[slug]/admin`

Top to bottom:

1. **Invite people** — invite code in large condensed type; **Share link** (Web Share API `navigator.share` with the `/join/{code}` URL, falling back to copy-to-clipboard); small "Reset code" (existing confirm). Visibility moves to Settings.
2. **Events** (event-by-event) — `Row` per round: date block, event name, status badge, "{picks} of {total} picks" / "Draft not set up", chevron → **Manage** (`/admin/r/id`). **No Delete here** (moved into round admin §7.2).
   - **Add an event:** a pick-list of upcoming TBA events (from `loadUpcomingEvents`, the landing page's source; tapping one fills the existing add-round flow and shows its "Found" preview), plus **"Other event"**: one input labeled "TBA link or event code (like 2025parr)" — a pasted `thebluealliance.com/event/{key}` URL is reduced to the key client-side before the existing check/add calls.
   - Secondary, collapsed: **Manual event** (existing `AddManualRoundForm`) and **Follow teams** (existing `FollowTeamsForm`, with the §6.10 helper text).
   - **Full-season leagues:** this section is **Season** — the current season row (→ Manage) and "Start {year} season" / note (existing logic).
3. **Members** — `Row` per member (name, Commissioner label); a ⋯ menu per row: Make commissioner / Make player / Remove (existing calls, existing confirms).
4. **Settings** — League name (existing `RenameLeague`), Who can see it (existing visibility control), Default scoring (`ScoringForm`, collapsed).
5. **Danger zone** — existing `DangerZone`.

The "View league page" / "Copy … link" header row is dropped (the league tabs and Share link cover it).

### 7.2 Round admin `/l/[slug]/admin/r/[roundId]`

Header: "‹ Admin" back link (this is a sub-page), event name, dates, status badge, key line. Then the **checklist** — four numbered steps, one open at a time by default (the one from `adminStep()`, §8.2); done steps show ✓ and a one-line summary with **Edit**; future steps show a muted one-line preview. **Any step can be opened at any time** (tapping the header toggles it) — nothing is locked.

| Step | Summary line when done | Content when open |
|---|---|---|
| 1 · Set up | "{n} players · {r} teams each · {snake/linear} order" | `RoundSetup` (roster size, draft order, team pool, scoring), restyled; the `<details>` wrapper is removed |
| 2 · Run the draft | "Draft complete · {picks} picks" | **Only the chosen method:** `draftMode === 'live'` → `LiveDraftControls` (timer, Start/Pause/Resume, **Open draft room**); `'commissioner'` → `DraftEntry`. A small link "Switch to {other method}" changes `draftMode` (existing PATCH, existing guards: disabled once started/picks exist). After the draft: "Fix a pick" (`DraftEntry`'s replace-a-pick). |
| 3 · During the event | "Scores came from TBA" / "{n} results entered" (manual) | **Refresh from TBA** (TBA/season rounds), `ManualResultsEditor` (manual rounds), `AdjustmentEditor` |
| 4 · Wrap up | "Final" | Today's finalize nudge copy, **Mark round final** / **Reopen round** (existing) |

Below the checklist, muted: **Delete this event** (existing delete call + confirm), moved here from the dashboard row.

## 8. New pure logic (unit-tested)

### 8.1 `upNext()` — `lib/views/upNext.ts`

```ts
export type UpNextInput = {
  leagueSlug: string; leagueName: string;
  roundId: string; eventName: string; startDate: string; endDate: string;
  status: RoundStatus;                       // lib/rounds/status.ts
  draftMode: 'live' | 'commissioner';
  draftPhase: DraftPhase;                    // lib/draft/live.ts
  myTurn: boolean;                           // onClockPlayer === my player id
  myRank: number | null; myPoints: number | null;
  winnerName: string | null;                 // rank-1 player when final/awaiting
  myTeams: string[];                         // team keys, draft order
};
export type UpNext = { kind: 'draft-live' | 'event-live' | 'results' | 'event-soon' | 'draft-soon'; item: UpNextInput } | null;
export function upNext(items: UpNextInput[], today: string): UpNext;
```

First matching rule wins; ties break by earliest `startDate`, then league name:

1. `draftPhase` is `live` or `paused` → `draft-live` (a `myTurn` item beats others).
2. `status === 'live'` → `event-live`.
3. `status` is `final` or `awaiting_final` and `today ≤ endDate + 3 days` → `results` (most recent `endDate` first).
4. `status === 'upcoming'` → `event-soon`.
5. `status` is `setup` or `drafting` and `endDate ≥ today` → `draft-soon`.
6. otherwise `null`.

Built by a `loadHome(userId, now)` view loader that reuses `loadMePage`'s league loading (no extra TBA calls beyond what Home makes today).

### 8.2 `adminStep()` — `lib/admin/steps.ts`

```ts
export type AdminStep = 1 | 2 | 3 | 4;
export function setupDone(round: { draftOrder: string[]; rosterSize: number }, playerIds: string[]): boolean;
//  true when rosterSize > 0, draftOrder is non-empty, and every current player id is in draftOrder
export function adminStep(status: RoundStatus, setupComplete: boolean): AdminStep;
//  setup && !setupComplete → 1 · setup | drafting → 2 · upcoming | live → 3 · awaiting_final | final → 4
export function stepDone(step: AdminStep, current: AdminStep): boolean;   // step < current
```

### 8.3 Others

- `lib/nav.ts` (§5.4).
- `lib/glossary.ts` (§4.7) — test that every key has a non-empty label and short text.
- `parseEventInput(s)` in `lib/admin/` — accepts `2025parr`, ` 2025PARR `, `https://www.thebluealliance.com/event/2025parr`, `.../event/2025parr#rankings` → `2025parr`; anything else returned trimmed/lowercased for the existing validator to reject.
- `shareOrCopy(url, title)` — client helper; not unit-tested beyond a fallback test with a stubbed `navigator`.
