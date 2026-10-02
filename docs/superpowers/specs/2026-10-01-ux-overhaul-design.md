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
