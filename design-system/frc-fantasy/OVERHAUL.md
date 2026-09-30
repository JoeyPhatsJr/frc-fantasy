# FRC Fantasy — UI overhaul brief ("make it a real app")

Supersedes BRIEF.md where they conflict. Behaviour, API, copy strings asserted by tests, and the
component prop names stay as they are; this is a visual + navigation overhaul. Direction chosen by
Joey: **app shell + visual richness, dark-first with a light toggle.**

## Where the look comes from

FRC's own visual world, not a generic "dark SaaS" kit:
- **Bumpers.** Every robot wears its number in bold white on red or blue bumper fabric. Team numbers
  are the identity of this game, so team chips everywhere become **bumper plates**: a rounded
  rectangle, number in Barlow Condensed 700, white on alliance blue (default) or red (used only for
  the red side of a match / danger).
- **The scoreboard.** Event scoreboards are dark with big tabular numerals in white and gold. The
  leaderboard is a scoreboard: rank column, name, and a big score; the leader's row carries the gold.
- **The field.** Dark grey carpet, white tape lines, blue/red alliance stations. Surfaces are deep
  navy-grey (not tinted black), separators are thin light lines, and the two alliance colours are the
  only strong hues besides gold.

**The one memorable thing:** the bumper-plate team number. Spend boldness there; keep everything else
quiet.

## Tokens (Tailwind 4 `@theme`, dark values by default; light values under `[data-theme=light]`)

| Token | Dark | Light (existing BRIEF.md values) | Role |
|---|---|---|---|
| `--color-bg` | `#0F1B2D` | `#EFF6FF` | page (field) |
| `--color-surface` | `#16243A` | `#FFFFFF` | cards, tab bar, header |
| `--color-surface-2` | `#1E2F4A` | `#F1F5FD` | raised rows, inputs |
| `--color-border` | `#2A3D5C` | `#E4ECFC` | 1px separators |
| `--color-fg` | `#F2F5F9` | `#0F172A` | text |
| `--color-fg-muted` | `#A7B4C7` | `#475569` | secondary text (≥4.5:1 on surface) |
| `--color-primary` | `#4F8BFF` | `#2563EB` | FRC blue: links, primary buttons, blue bumpers |
| `--color-primary-strong` | `#3B6FE0` | `#1D4ED8` | pressed |
| `--color-on-primary` | `#FFFFFF` | `#FFFFFF` | |
| `--color-red-alliance` | `#E4322B` | `#DC2626` | red bumpers, danger |
| `--color-accent` | `#F5B301` | `#F59E0B` | gold: leader, points gained, live pulse |
| `--color-on-accent` | `#1A1300` | `#1A1300` | text on gold |
| `--color-accent-text` | `#FFD35C` | `#B45309` | gold as TEXT on surfaces (contrast-safe) |
| `--color-success` | `#2FBF71` | `#15803D` | live badge, saved |
| `--color-warning` | `#FFD35C` | `#B45309` | stale banners |
| `--color-secondary` | `#9B7BFF` | `#7C3AED` | commissioner label, drafting badge |
| `--color-ring` | `#4F8BFF` | `#2563EB` | focus |

Radii: cards 14px (`--radius-card`), bumper plates 6px (`--radius-plate`), pills full. Shadows: none in
dark (use `surface-2` and borders for elevation); the light theme keeps `--shadow-card`.

Theme switching: `<html data-theme="dark|light">`, set before hydration by an inline script that reads
`localStorage['frcf:theme']` and falls back to `prefers-color-scheme`. A sun/moon `ThemeToggle` in the
header (client component). `color-scheme` set accordingly so native controls match.

## Type

Keep Barlow Condensed (display) + Barlow (body); they already say "sports". Scale (px / line-height):
13/18 caption · 15/22 body · 17/24 emphasis · 22/26 section title · 28/30 page title · 40/40 hero
number · 56/56 draft banner number. Display weight 700; body 400/500/600. Tabular numerals on every
score. Sentence case for headings and labels — **no all-caps eyebrows**; the only uppercase is the
"FRC FANTASY" wordmark and bumper-plate numbers (which are digits anyway). Do not use "·" separators;
use spacing or a line break.

## App shell

```
┌──────────────────────────────┐
│ ◉ FRC FANTASY      ☾/☀       │  header: wordmark (home), theme toggle. 56px, surface, 1px border-b
│ Habich Fam                 ● │  league bar (inside /l/[slug]): name, live dot if any round is live
├──────────────────────────────┤
│                              │
│   page content (max-w-2xl)   │
│                              │
├──────────────────────────────┤
│  ▤ Standings  ⌁ Round  ⚙ Admin │  bottom tab bar, only under /l/[slug]; 64px + safe-area inset
└──────────────────────────────┘
```

- **Bottom tab bar** (`components/TabBar.tsx`, client): shows under `/l/[slug]/**` only. Tabs:
  **Standings** → `/l/{slug}`; **Round** → the most relevant round (live > upcoming > latest; the
  server passes the target round id, or the tab is hidden when there are no rounds); **Admin** →
  `/l/{slug}/admin`, rendered only when `localStorage['frcf:admin:{slug}']` exists (client check;
  render nothing for that slot until mounted). Active tab is primary-coloured; icons Lucide 24px;
  labels 13px; 44px targets; `padding-bottom: env(safe-area-inset-bottom)`. On ≥ md widths the same
  component renders as a segmented control under the league bar instead of a fixed bottom bar.
- **Header** stays sticky; the league bar is server-rendered (so it can show the live dot).
- **Back navigation**: round and admin pages show a compact back link at the start of the content,
  never a second header.
- **Loading**: `app/l/[slug]/loading.tsx` and `app/l/[slug]/r/[roundId]/loading.tsx` render
  skeleton rows (surface-2 blocks, `motion-safe:animate-pulse`) shaped like the scoreboard.
- **Empty states** say what to do next ("No rounds yet — the commissioner adds one from Admin").

## Page treatments

**Standings (`/l/[slug]`)**
- If a round is live: a "Live now" scoreboard card first — round name, the top 3 with scores, and a
  "See rosters" button — with the live pulse dot.
- Season scoreboard: rows are 56px; rank in a 32px circle (gold #1, silver #2, bronze #3, muted rest);
  name; score in display 28px right-aligned. Leader row: gold left rail (3px) + faint gold tint.
  Per-round mini scores under the name in muted 13px, separated by spaces.
- Rounds list: each row = date block on the left (month over day, display font) + event name + status
  badge; whole row tappable.

**Round (`/l/[slug]/r/[roundId]`)**
- Top: event name (28px), date, status badge, TBA link as a small secondary button, freshness line.
- Round scoreboard identical to the season one (same component).
- Rosters: each player is a card; header row = 36px initial circle, name, "4 teams", score. Expanded:
  each team is a row with a **bumper plate** (number) + nickname + points; category lines are a
  two-column list, gold text for +, red for −. Zero lines hidden.
- Draft board: one block per draft round; cells are bumper plates with the picker's name under them.
- Adjustments: rows with reason and a gold/red points pill.

**Home (`/`)**
- Hero: the wordmark large, one sentence, then a **bumper-plate strip** (a row of real numbers —
  341, 5181, 2607, 103, 9998 — in alternating blue/red plates) as the visual, then the Create league
  card. No icon-bullet row.

**Commissioner dashboard**
- League bar shows "Commissioner" in secondary (violet) next to the league name.
- Sections are cards; players are rows with inline rename and a trailing remove icon button; rounds
  are the same date-block rows as the public page with "Manage" and "Delete".
- Add round: the Check → preview → Add flow, preview rendered as a date-block row with a gold "Add
  this round" button.

**Round admin (draft night)**
- Banner: full-width primary card, 56px display number for the pick ("Pick 7 of 20"), then
  "Mom's turn, round 2" on the second line at 17px. When complete: success-tinted. (The existing
  `draftBanner()` string must still appear verbatim for tests — render it visually hidden or keep the
  plain-text line under the big number.)
- Search stays sticky under the league bar while the team grid scrolls.
- Team grid: 2 columns of bumper plates (56px tall) with nickname under the number; pressed state is
  a 2px gold ring. Tapping records immediately (unchanged).
- Draft board and "Replace a pick" as on the public page, with Replace as an icon button.
- Setup / Adjustments / Data sections stay collapsible cards.

## Motion

One orchestrated moment: on the standings page's first paint, rows fade in with a 40 ms stagger
(`motion-safe:` only, once per navigation). The live dot pulses. Everything else is instant or a
150–200 ms colour transition on press. Respect `prefers-reduced-motion`.

## Components to add / change

- `components/ui/BumperPlate.tsx` — `{ number: string; side?: 'blue' | 'red'; size?: 'sm'|'md'|'lg' }`
  (sm 28px inline, md 40px rows, lg 56px draft grid); `aria-label="Team 341"`.
- `components/TabBar.tsx`, `components/LeagueBar.tsx`, `components/ThemeToggle.tsx`,
  `components/Skeleton.tsx`, `components/DateBlock.tsx`.
- `components/Leaderboard.tsx` → scoreboard treatment; `RosterList`, `DraftBoard`, `AdjustmentList`,
  `Freshness`, `StatusBadge` restyled; `components/ui/*` tokens updated (Button `accent` uses gold with
  `on-accent` text).
- `app/layout.tsx` (theme script, header with toggle), `app/globals.css` (both themes),
  `app/l/[slug]/layout.tsx` (league bar + tab bar; loads league name + live/target round once).

## Guardrails (unchanged)

360px no horizontal scroll; 44px targets; contrast ≥ 4.5:1 in BOTH themes (gold as text only via
`--color-accent-text`; gold fills use `on-accent` text); visible focus; tokens only; Lucide icons
only; every existing test stays green; no new dependencies.
