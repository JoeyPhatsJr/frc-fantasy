# UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild every screen of FRC Fantasy around a never-leaving bottom bar, status-driven "what's next" screens, one expandable leaderboard, a numbered admin checklist and a broadcast-scoreboard visual system — without touching rules, scoring, schema, APIs or draft logic.

**Architecture:** UI-only change on branch `ux-overhaul`, built in 5 layers: tokens + primitives → shell + navigation → player screens → admin → polish/verify. New behavior that can be expressed as pure functions (`lib/nav.ts`, `upNext`, `adminStep`, `parseEventInput`, `roundStrip`, glossary) is unit-tested first; components are tested by `renderToStaticMarkup` string assertions, the repo's existing UI-test style.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind 4 (`@theme` tokens in `app/globals.css`), Vitest 5 (node env, `tests/**/*.test.ts`), Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-10-01-ux-overhaul-design.md` — read it before every task; section numbers below (§) refer to it.

## Global Constraints

- **Read-only paths:** `lib/draft/*`, `lib/scoring/*`, `lib/tba/*`, `lib/db/*`, `app/api/**`, `components/draft/useDraftRoom.ts`. New read-only loaders in `lib/views/*` may only call existing repo methods. (§3)
- **No schema, migration, API, caching, scoring or draft-engine changes.** (§3)
- Light theme is the default; both themes must work. Token names stay; values change; new tokens `band`, `on-band`, `band-muted`. (§4.1)
- Tap targets ≥ 44px (`min-h-11`); visible focus ring (`focus-visible:ring-2 focus-visible:ring-ring`); works at 360px wide with no horizontal scroll; content column `max-w-2xl` centered with 16px (`px-4`) gutter. (§4.3)
- Bumper plates default blue; red only for red-alliance/danger; never alternate by index. (§4.2)
- Purple (`secondary`) is used for the "Commissioner" label only. (§4.2)
- Copy: "Create a league" (never "Create league"); forgot password → "Forgot your password? Ask the league commissioner to reset it."; stat labels come from `lib/glossary.ts`. (§4.7, §6.2, §6.9)
- Every page keeps `export const dynamic = 'force-dynamic'` where it has it today (`tests/config/dynamic-exports.test.ts` enforces this); new pages add it too.
- Components are server components unless they need state/effects (`'use client'` only where needed, as today).
- Run before every commit: `npx vitest run` (all green) and `npx tsc --noEmit` (clean). The project path contains a space — always quote it.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No per-task review (Joey's standing preference); implementers self-review hard and append risky spots to `.superpowers/sdd/2026-10-01-ux-overhaul/final-review-notes.md`.

## Review Focus

1. **Empty leagues and rounds:** a signed-in user in zero leagues, and a league with zero rounds, must render every tab (Home, Standings, Event, Draft, Admin) with an empty state — never a crash or 404. (Tests in Tasks 6, 9, 11.)
2. **Long names at 360px:** league names, player names and event names of 40+ characters ("Indiana State Championship presented by Toyota") must truncate/wrap inside rows, header band and status strip with no horizontal scroll. (`truncate`/`min-w-0`/`break-words` assertions in Tasks 3, 6, 10.)
3. **Signed-out visitor on a `link`-visibility league:** league header without Switch, ⋯ menu or Admin tab; no bottom bar; no live-draft pill; no "(you)" highlight. (Tests in Tasks 5, 6, 7, 10.)
4. **Watchers and former members:** in the draft room a non-member gets Pool · Board only (no My queue, no auto-draft switch); a player who left shows as "Name (left)" and is never highlighted as "you". (Tests in Tasks 10, 12.)
5. **Database asleep / loader failure:** the live-draft pill and the league header's switcher must fail closed (render nothing) so the page still renders its friendly error. (Tests in Tasks 6, 7.)

---

## File map

**Create**
- `lib/glossary.ts` — term → `{ label, short }`
- `lib/views/upNext.ts` — `upNext`, `leagueStatusLine` (pure)
- `lib/views/home.ts` — `loadHome(userId, now)` (replaces `loadMePage`)
- `lib/views/liveDrafts.ts` — `loadMyLiveDrafts(userId)`
- `lib/views/roundStrip.ts` — `roundStrip(view, now)` (pure)
- `lib/admin/steps.ts` — `setupDone`, `adminStep`, `stepDone`
- `lib/admin/eventInput.ts` — `parseEventInput`
- `components/ui/Row.tsx`, `Section.tsx`, `StatusStrip.tsx`, `Tabs.tsx`, `PageTabs.tsx`, `Sheet.tsx`, `InfoTip.tsx`
- `components/shell/BottomBar.tsx`, `AppHeader.tsx`, `LeagueHeader.tsx`, `LeagueMenu.tsx`, `LeagueSwitcher.tsx`, `LiveDraftPill.tsx`
- `components/home/UpNextCard.tsx`
- `components/event/PlayerBoard.tsx` (expandable leaderboard), `EventSwitcher.tsx`, `ScoringSheet.tsx`
- `components/standings/SeasonBoard.tsx`, `EventList.tsx`
- `components/you/AppearanceControl.tsx`, `MySeason.tsx`
- `components/admin/InviteCard.tsx`, `EventPicker.tsx`, `RoundChecklist.tsx`
- `app/you/page.tsx`, `app/l/[slug]/draft/page.tsx`
- `scripts/screens.ts`, `e2e/navigation.spec.ts`
- Tests: `tests/ui/contrast.test.ts`, `tests/glossary.test.ts`, `tests/ui/layout-primitives.test.ts`, `tests/nav.test.ts`, `tests/views/upNext.test.ts`, `tests/views/roundStrip.test.ts`, `tests/views/liveDrafts.test.ts`, `tests/admin/steps.test.ts`, `tests/admin/eventInput.test.ts`, `tests/ui/shell-v3.test.ts`, `tests/ui/event.test.ts`, `tests/ui/home.test.ts`, `tests/ui/admin-v3.test.ts`

**Modify (major)**
- `app/globals.css`, `app/layout.tsx`, `app/l/[slug]/layout.tsx`, `lib/nav.ts`
- `app/page.tsx`, `app/leagues/page.tsx`, `app/l/[slug]/page.tsx`, `app/l/[slug]/r/[roundId]/page.tsx`, `app/l/[slug]/r/[roundId]/draft/page.tsx`, `app/me/settings/page.tsx` (→ redirect), `app/join/[code]/page.tsx`, `app/signin/page.tsx`, `app/leagues/new/page.tsx`
- `components/ui/*` (restyle), `components/draft/DraftRoom.tsx`, `DraftRoomBanner.tsx`, `PoolList.tsx`, `components/pool/PoolStats.tsx`, `components/admin/AdminDashboard.tsx`, `DashboardParts.tsx`, `MembersCard.tsx`, `RoundAdmin.tsx`, `components/landing/*`, `components/JoinView.tsx`, `components/SignInForm.tsx`, `components/CreateLeagueForm.tsx`, `components/SettingsForm.tsx`, `components/me/LeagueRows.tsx`

**Delete (only after `tsc` shows no importers, Task 17)**
- `components/AppTabBar.tsx`, `TabBar.tsx`, `LeagueBar.tsx`, `HeaderAccount.tsx`, `ThemeToggle.tsx`, `LeagueMeCard.tsx` (logic moves to `LeagueMenu`), `Leaderboard.tsx`, `RosterList.tsx`, `components/me/MeHome.tsx`, `components/draft/LiveDraftBanner.tsx`, `components/draft/DraftRosters.tsx`, `lib/views/me.ts` (after `loadHome` replaces it; keep `seasonSummary` by moving it into `lib/views/home.ts`). `lib/draft/liveBanner.ts` is read-only and stays (it loses its UI callers).

---

## Phase 1 — Visual system

### Task 1: Color tokens + contrast test

**Files:**
- Modify: `app/globals.css` (the `@theme` block, lines ~20–70, and the `:root[data-theme="light"]` block, lines ~99–135)
- Modify: `app/layout.tsx` (only `viewport.themeColor`)
- Modify: `design-system/frc-fantasy/OVERHAUL.md` (3-line note at the top)
- Create: `tests/ui/contrast.test.ts`

**Interfaces:**
- Produces: Tailwind utilities `bg-band`, `text-on-band`, `text-band-muted` (from new tokens `--color-band`, `--color-on-band`, `--color-band-muted`); every existing token name unchanged.

- [ ] **Step 1: Write the failing test** — `tests/ui/contrast.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');

/** Token values inside the first block that starts with `opener`. */
function tokens(opener: RegExp): Record<string, string> {
  const start = css.search(opener);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const dark = tokens(/@theme\s*\{/);
const light = { ...dark, ...tokens(/:root\[data-theme="light"\]\s*\{/) };

const PAIRS: [string, string][] = [
  ['fg', 'bg'], ['fg', 'surface'], ['fg-muted', 'bg'], ['fg-muted', 'surface'],
  ['primary', 'bg'], ['primary', 'surface'], ['on-primary', 'primary-fill'],
  ['on-band', 'band'], ['band-muted', 'band'], ['accent-text', 'bg'], ['on-accent', 'accent'],
  ['red-alliance-text', 'bg'], ['on-success', 'success'],
];

describe.each([['dark', dark], ['light', light]] as const)('%s theme tokens', (_name, t) => {
  it('defines the broadcast band tokens', () => {
    for (const k of ['band', 'on-band', 'band-muted']) expect(t[k], k).toMatch(/^#[0-9a-f]{6}$/);
  });
  it.each(PAIRS)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(t[fg], fg).toBeDefined();
    expect(t[bg], bg).toBeDefined();
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
  it('no longer uses the stock Tailwind light palette', () => {
    expect(Object.values(t)).not.toContain('#eff6ff');
    expect(Object.values(t)).not.toContain('#2563eb');
  });
  it('podium colors are at least 3:1 on the page', () => {
    expect(contrast(t.silver, t.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(t.bronze, t.bg)).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd "/Users/joeyhabich/Claude/FRC Fantasy" && npx vitest run tests/ui/contrast.test.ts`
Expected: FAIL — `band` undefined; light theme contains `#eff6ff`.

- [ ] **Step 3: Update `app/globals.css`**

In the `@theme` block (dark defaults) set these values and add the three band tokens after `--color-fg-muted` (keep the existing comments style; keep every other token):

```css
  --color-bg: #0d131d;             /* page (de-saturated field navy) */
  --color-surface: #151d2a;        /* raised rows, sheets, inputs */
  --color-surface-2: #1c2636;      /* pressed rows, skeletons */
  --color-border: #283447;         /* hairline dividers */
  --color-fg: #eef2f7;
  --color-fg-muted: #9ba8ba;
  --color-band: #080b11;           /* broadcast header band */
  --color-on-band: #ffffff;
  --color-band-muted: #8592a8;     /* inactive tab labels on the band */
  --color-primary: #6aa2ff;
  --color-primary-fill: #2f6fe0;
  --color-primary-strong: #255ac0;
  --color-on-success: #0d131d;
  --color-on-secondary: #0d131d;
  --color-ring: #6aa2ff;
```

In `:root[data-theme="light"]` set:

```css
    --color-bg: #f4f2ee;
    --color-surface: #ffffff;
    --color-surface-2: #ebe8e2;
    --color-border: #dcd8d0;
    --color-fg: #16181d;
    --color-fg-muted: #5f5b53;
    --color-band: #14171f;
    --color-on-band: #ffffff;
    --color-band-muted: #9aa3b5;
    --color-primary: #0a52b0;
    --color-primary-fill: #0a5bc4;
    --color-primary-strong: #08489c;
    --color-red-alliance: #d0261d;
    --color-red-alliance-text: #b3201a;
    --color-accent: #f2a900;
    --color-accent-strong: #d99800;
    --color-accent-text: #8a5a00;
    --color-success: #127a3a;
    --color-warning: #9a5b00;
    --color-secondary: #6d3fd1;
    --color-ring: #0a52b0;
    --color-silver: #7d8794;
    --color-bronze: #9a5a22;
```

Also change `--radius-card` to `10px`. In `app/layout.tsx` set `viewport.themeColor` to `#14171f` (light) and `#080b11` (dark) — the header becomes the band in Task 5. If any pair fails, nudge the value (same hue, darker/lighter) until it passes, and list each nudge in the commit body.

- [ ] **Step 4: Run** `npx vitest run tests/ui/contrast.test.ts` → PASS; then `npx vitest run` → all green.

- [ ] **Step 5: OVERHAUL.md note** — prepend:

```md
> **Superseded in part (2026-10-01):** palette, card usage and navigation are now defined by
> `docs/superpowers/specs/2026-10-01-ux-overhaul-design.md` §4–§5. Bumper plates, Barlow type and the
> scoreboard idea carry over.
```

- [ ] **Step 6: Commit**

```bash
git add app/globals.css app/layout.tsx tests/ui/contrast.test.ts design-system/frc-fantasy/OVERHAUL.md
git commit -m "feat(ux): broadcast-scoreboard color tokens + AA contrast test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Glossary + InfoTip + restyled existing primitives

**Files:**
- Create: `lib/glossary.ts`, `components/ui/InfoTip.tsx`, `tests/glossary.test.ts`
- Modify: `components/ui/Button.tsx`, `Badge.tsx`, `Alert.tsx`, `Card.tsx`, `Input.tsx`, `Select.tsx`, `BumperPlate.tsx`
- Modify: `tests/ui/primitives.test.ts`

**Interfaces:**
- Produces:
  - `export type GlossaryKey = 'opr' | 'proj' | 'rp' | 'quals' | 'playoffs' | 'alliance' | 'queue' | 'autodraft' | 'snake' | 'pool' | 'adjust' | 'eventcode' | 'commish'`
  - `export const GLOSSARY: Record<GlossaryKey, { label: string; short: string }>`
  - `export function InfoTip({ term }: { term: GlossaryKey })` (client component)
  - Existing primitive exports/props unchanged.

- [ ] **Step 1: Verify glossary copy against the engine.** Read `lib/draft/advance.ts`, `lib/draft/state.ts` (what is picked on timer expiry and on auto-draft) and `lib/pool/*` (what "Proj" is computed from). Adjust the `queue`, `autodraft`, `snake`, `proj` short texts in Step 4 so they describe what the code actually does; record any change in `final-review-notes.md`.

- [ ] **Step 2: Write the failing test** — `tests/glossary.test.ts`

```ts
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GLOSSARY, type GlossaryKey } from '@/lib/glossary';
import { InfoTip } from '@/components/ui/InfoTip';

const KEYS: GlossaryKey[] = ['opr', 'proj', 'rp', 'quals', 'playoffs', 'alliance', 'queue', 'autodraft', 'snake', 'pool', 'adjust', 'eventcode', 'commish'];

describe('GLOSSARY', () => {
  it('has a label and a one-sentence explainer for every term', () => {
    expect(Object.keys(GLOSSARY).sort()).toEqual([...KEYS].sort());
    for (const k of KEYS) {
      expect(GLOSSARY[k].label.length, k).toBeGreaterThan(1);
      expect(GLOSSARY[k].short, k).toMatch(/^[A-Z].*\.$/);
      expect(GLOSSARY[k].short.length, k).toBeLessThanOrEqual(140);
    }
  });
  it('spells out jargon', () => {
    expect(GLOSSARY.opr.label).toBe('Robot rating (OPR)');
    expect(GLOSSARY.rp.label).toBe('Ranking points');
    expect(GLOSSARY.proj.label).toBe('Projected');
  });
});

describe('InfoTip', () => {
  it('is a 44px button labelled with the term, closed by default', () => {
    const html = renderToStaticMarkup(h(InfoTip, { term: 'opr' }));
    expect(html).toMatch(/^<span/);
    expect(html).toContain('aria-label="What is Robot rating (OPR)?"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('size-11');
    expect(html).not.toContain(GLOSSARY.opr.short);
  });
});
```

- [ ] **Step 3: Run** `npx vitest run tests/glossary.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `lib/glossary.ts`**

```ts
export type GlossaryKey =
  | 'opr' | 'proj' | 'rp' | 'quals' | 'playoffs' | 'alliance'
  | 'queue' | 'autodraft' | 'snake' | 'pool' | 'adjust' | 'eventcode' | 'commish';

/** One wording for every stat and FRC term, shared by labels and ⓘ explainers (spec §4.7). */
export const GLOSSARY: Record<GlossaryKey, { label: string; short: string }> = {
  opr: { label: 'Robot rating (OPR)', short: "How many points a robot adds to its alliance's score, from The Blue Alliance." },
  proj: { label: 'Projected', short: 'Points we expect this team to earn at this event.' },
  rp: { label: 'Ranking points', short: 'Points teams earn in qualification matches; they decide the rankings.' },
  quals: { label: 'Qualification matches', short: 'The first part of an event. Every team plays several random matches.' },
  playoffs: { label: 'Playoffs', short: 'The elimination bracket after alliance selection.' },
  alliance: { label: 'Alliance selection', short: 'Top-ranked teams pick partners for the playoffs.' },
  queue: { label: 'Your queue', short: "Teams you want, in order. If you're on auto-draft or your timer runs out, we pick the top one still available." },
  autodraft: { label: 'Auto-draft', short: 'We pick for you each turn: the top of your queue, or the best team left.' },
  snake: { label: 'Snake order', short: 'Pick order reverses every round: first to last, then last to first.' },
  pool: { label: 'Team pool', short: 'The teams that can be drafted for this event.' },
  adjust: { label: 'Adjustments', short: 'Points the commissioner added or removed by hand, with a reason.' },
  eventcode: { label: 'Event code', short: "The Blue Alliance's ID for an event, like 2025parr." },
  commish: { label: 'Commissioner', short: 'The person who runs the league.' },
};
```

(Apply any Step 1 corrections.)

- [ ] **Step 5: Implement `components/ui/InfoTip.tsx`**

```tsx
'use client';

import { useId, useState } from 'react';
import { Info } from '@/components/ui/icons';
import { GLOSSARY, type GlossaryKey } from '@/lib/glossary';

/** ⓘ next to a term: tap to show its one-line explainer inline (spec §4.6). */
export function InfoTip({ term }: { term: GlossaryKey }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { label, short } = GLOSSARY[term];
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        aria-label={`What is ${label}?`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="-my-3 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-fg-muted hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="size-4" />
      </button>
      {open ? (
        <span id={id} role="note" className="mt-1 block max-w-xs text-[13px] font-normal leading-5 text-fg-muted">
          {short}
        </span>
      ) : null}
    </span>
  );
}
```

- [ ] **Step 6: Restyle primitives.** Keep every exported name, prop and test-visible behavior (`min-h-11`, `cursor-pointer`, `focus-visible:ring-2`, `<a>` for href, spinner, `buttonClass`):
  - `Button.tsx`: in `BASE` replace `rounded-pill` → `rounded-lg`, `focus-visible:ring-offset-surface` → `focus-visible:ring-offset-bg`. `VARIANTS.secondary` = `'border border-fg/25 bg-transparent text-fg hover:bg-surface-2 active:bg-surface-2'`; `VARIANTS.ghost` = `'bg-transparent text-primary hover:bg-surface-2'`.
  - `Badge.tsx`: `TONES.drafting` = `'bg-surface-2 text-fg ring-1 ring-inset ring-border'`; `TONES.upcoming` = `'bg-surface-2 text-primary ring-1 ring-inset ring-border'`; base `rounded-pill` → `rounded-[4px]`, typography `text-[11px] font-bold uppercase tracking-[.08em] leading-4 px-2 py-0.5`.
  - `Card.tsx`: remove `shadow-card`; `border border-border bg-surface rounded-card`; title in the Section label style (`text-[11px] font-bold uppercase tracking-[.12em] text-fg-muted`).
  - `Alert.tsx`: no fills; a left-ruled note — `border-l-4 bg-surface pl-3 pr-3 py-2 text-[15px] text-fg` with the tone on the border (`border-primary`, `border-success`, `border-warning`, `border-red-alliance`); keep `role` attributes.
  - `Input.tsx`/`Select.tsx`: `rounded-lg`, `bg-surface border-border`; keep label/error/hint markup.
  - `BumperPlate.tsx`: keep API; replace `shadow-plate` with `shadow-[inset_0_-2px_0_rgb(0_0_0/.25)]`.

- [ ] **Step 7: Update `tests/ui/primitives.test.ts`.** Change only assertions on removed classes (`rounded-pill` on Button/Badge, `shadow-card` on Card, Alert fill classes) to the new classes. Add:

```ts
it('Badge drafting tone is neutral, not purple', () => {
  const html = render(h(Badge, { tone: 'drafting' }, 'Drafting'));
  expect(html).not.toContain('bg-secondary');
  expect(html).toContain('bg-surface-2');
});
it('BumperPlate is blue unless told red', () => {
  expect(render(h(BumperPlate, { number: '5181' }))).toContain('bg-primary-fill');
  expect(render(h(BumperPlate, { number: '5181', side: 'red' }))).toContain('bg-red-alliance');
});
```

Other UI tests (`tests/ui/*.test.ts`) that assert old classes on these primitives: update them the same way. Do not weaken tests that assert behavior.

- [ ] **Step 8: Run** `npx vitest run && npx tsc --noEmit` → green.

- [ ] **Step 9: Commit** — `feat(ux): glossary, InfoTip and restyled primitives` (+ Co-Authored-By line).

### Task 3: Layout primitives — Row, Section, StatusStrip, Tabs, Sheet

**Files:**
- Create: `components/ui/Row.tsx`, `Section.tsx`, `StatusStrip.tsx`, `Tabs.tsx`, `PageTabs.tsx`, `Sheet.tsx`
- Create: `tests/ui/layout-primitives.test.ts`

**Interfaces:**
- Produces:

```ts
// Row.tsx (server-safe; expandable rows use <details>/<summary>, no client JS)
export type RowProps = {
  leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode;
  href?: string; highlight?: boolean; expanded?: ReactNode; defaultOpen?: boolean; className?: string;
};
export function Row(p: RowProps): JSX.Element;
export function RankNumeral({ rank }: { rank: number }): JSX.Element;
export function Points({ value, size }: { value: number | null; size?: 'lg' | 'md' }): JSX.Element;
// Section.tsx
export function Section(p: { label: string; action?: ReactNode; children: ReactNode; className?: string; id?: string }): JSX.Element;
// StatusStrip.tsx
export type StripTone = 'neutral' | 'live' | 'final' | 'drafting' | 'warning';
export function StatusStrip(p: { tone: StripTone; title: ReactNode; detail?: ReactNode; action?: ReactNode; switcher?: ReactNode }): JSX.Element;
// Tabs.tsx (server-safe)
export type TabItem = { key: string; label: string; href: string };
export function BandTabs(p: { items: TabItem[]; active: string | null; label: string }): JSX.Element;
// PageTabs.tsx ('use client')
export function PageTabs(p: { items: { key: string; label: string }[]; active: string; onSelect: (key: string) => void; label: string }): JSX.Element;
// Sheet.tsx ('use client')
export function Sheet(p: { open: boolean; onClose: () => void; title: string; children: ReactNode }): JSX.Element | null;
```

- [ ] **Step 1: Write the failing tests** — `tests/ui/layout-primitives.test.ts`

```ts
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Row, RankNumeral, Points } from '@/components/ui/Row';
import { Section } from '@/components/ui/Section';
import { StatusStrip } from '@/components/ui/StatusStrip';
import { BandTabs } from '@/components/ui/Tabs';
import { Sheet } from '@/components/ui/Sheet';

const r = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('Row', () => {
  it('is a plain row with hairline divider and truncating title', () => {
    const html = r(h(Row, { title: 'Indiana State Championship presented by Toyota', trailing: '212' }));
    expect(html).toContain('border-b border-border');
    expect(html).toContain('min-w-0');
    expect(html).toContain('truncate');
    expect(html).toContain('min-h-11');
  });
  it('is a link when given href', () => {
    expect(r(h(Row, { title: 'Family', href: '/l/fam' }))).toMatch(/<a [^>]*href="\/l\/fam"/);
  });
  it('highlights your row with the blue inset bar', () => {
    const html = r(h(Row, { title: 'Joey', highlight: true }));
    expect(html).toContain('bg-surface');
    expect(html).toContain('shadow-[inset_4px_0_0_var(--color-primary-fill)]');
  });
  it('expands with details/summary, open when defaultOpen', () => {
    const closed = r(h(Row, { title: 'Mom', expanded: h('p', null, 'teams') }));
    expect(closed).toMatch(/^<details/);
    expect(closed).toContain('<summary');
    expect(closed).not.toContain(' open=""');
    expect(r(h(Row, { title: 'Joey', expanded: 'x', defaultOpen: true }))).toContain(' open=""');
  });
});

describe('RankNumeral / Points', () => {
  it('colors the podium', () => {
    expect(r(h(RankNumeral, { rank: 1 }))).toContain('text-accent-text');
    expect(r(h(RankNumeral, { rank: 2 }))).toContain('text-silver');
    expect(r(h(RankNumeral, { rank: 3 }))).toContain('text-bronze');
    expect(r(h(RankNumeral, { rank: 4 }))).toContain('text-fg-muted');
  });
  it('shows a dash for no score', () => {
    expect(r(h(Points, { value: null }))).toContain('—');
    expect(r(h(Points, { value: 212 }))).toContain('tabular-nums');
  });
});

describe('Section', () => {
  it('renders an uppercase label heading', () => {
    const html = r(h(Section, { label: 'Your leagues' }, 'rows'));
    expect(html).toContain('<h2');
    expect(html).toContain('uppercase');
    expect(html).toContain('Your leagues');
  });
});

describe('StatusStrip', () => {
  it('shows LIVE with a pulsing dot for live', () => {
    const html = r(h(StatusStrip, { tone: 'live', title: 'Ramp Riot', detail: 'updated 1 min ago' }));
    expect(html).toContain('LIVE');
    expect(html).toContain('motion-safe:animate-pulse');
    expect(html).toContain('role="status"');
  });
  it('wraps long titles instead of overflowing', () => {
    expect(r(h(StatusStrip, { tone: 'neutral', title: 'x' }))).toContain('break-words');
  });
});

describe('BandTabs', () => {
  it('marks the active tab with aria-current and the gold underline', () => {
    const html = r(h(BandTabs, { label: 'League', active: 'event', items: [
      { key: 'standings', label: 'Standings', href: '/l/f' },
      { key: 'event', label: 'Event', href: '/l/f/r/1' },
    ] }));
    expect(html).toContain('aria-label="League"');
    expect(html).toMatch(/href="\/l\/f\/r\/1"[^>]*aria-current="page"/);
    expect(html).toContain('border-accent');
    expect(html).toContain('min-h-11');
  });
});

describe('Sheet', () => {
  it('renders nothing when closed and a modal dialog when open', () => {
    expect(r(h(Sheet, { open: false, onClose: () => {}, title: 'Leagues' }, 'x'))).toBe('');
    const html = r(h(Sheet, { open: true, onClose: () => {}, title: 'Leagues' }, 'x'));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Close"');
  });
});
```

- [ ] **Step 2: Run** → FAIL (modules missing).

- [ ] **Step 3: Implement `components/ui/Row.tsx`**

```tsx
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronDown } from '@/components/ui/icons';

export type RowProps = {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  highlight?: boolean;
  expanded?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

const BASE = 'flex min-h-11 w-full items-center gap-3 border-b border-border px-4 py-2.5 text-left';
const HIGHLIGHT = 'bg-surface shadow-[inset_4px_0_0_var(--color-primary-fill)]';
const FOCUS = 'cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

function Body({ leading, title, subtitle, trailing, chevron }: Pick<RowProps, 'leading' | 'title' | 'subtitle' | 'trailing'> & { chevron?: boolean }) {
  return (
    <>
      {leading ? <span className="flex shrink-0 items-center">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-fg">{title}</span>
        {subtitle ? <span className="block truncate text-[13px] text-fg-muted">{subtitle}</span> : null}
      </span>
      {trailing ? <span className="flex shrink-0 items-center gap-2">{trailing}</span> : null}
      {chevron ? <ChevronDown className="size-4 shrink-0 text-fg-muted motion-safe:transition-transform group-open:rotate-180" /> : null}
    </>
  );
}

/** A list row on the page background: hairline divider, optional link or expansion (spec §4.3, §4.6). */
export function Row({ leading, title, subtitle, trailing, href, highlight, expanded, defaultOpen, className }: RowProps) {
  const tone = highlight ? HIGHLIGHT : '';
  if (expanded !== undefined) {
    return (
      <details className={['group', tone, className].filter(Boolean).join(' ')} open={defaultOpen || undefined}>
        <summary className={`${BASE} ${FOCUS} list-none [&::-webkit-details-marker]:hidden`}>
          <Body leading={leading} title={title} subtitle={subtitle} trailing={trailing} chevron />
        </summary>
        <div className="border-b border-border bg-surface px-4 py-2 pl-12">{expanded}</div>
      </details>
    );
  }
  if (href) {
    return (
      <Link href={href} className={[BASE, FOCUS, tone, 'hover:bg-surface-2', className].filter(Boolean).join(' ')}>
        <Body leading={leading} title={title} subtitle={subtitle} trailing={trailing} />
      </Link>
    );
  }
  return (
    <div className={[BASE, tone, className].filter(Boolean).join(' ')}>
      <Body leading={leading} title={title} subtitle={subtitle} trailing={trailing} />
    </div>
  );
}

const PODIUM: Record<number, string> = { 1: 'text-accent-text', 2: 'text-silver', 3: 'text-bronze' };

export function RankNumeral({ rank }: { rank: number }) {
  return (
    <span className={`w-6 text-center font-display text-[22px] font-bold leading-none tabular-nums ${PODIUM[rank] ?? 'text-fg-muted'}`}>
      {rank}
    </span>
  );
}

export function Points({ value, size = 'lg' }: { value: number | null; size?: 'lg' | 'md' }) {
  const cls = size === 'lg' ? 'text-[26px]' : 'text-[19px]';
  return <span className={`font-display ${cls} font-bold leading-none tabular-nums text-fg`}>{value === null ? '—' : value}</span>;
}
```

- [ ] **Step 4: Implement `components/ui/Section.tsx`**

```tsx
import type { ReactNode } from 'react';

/** An uppercase label over a run of rows (spec §4.3). Rows sit flush to the page edges. */
export function Section({ label, action, children, className, id }: { label: string; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  const headingId = id ? `${id}-h` : undefined;
  return (
    <section aria-labelledby={headingId} className={['-mx-4', className].filter(Boolean).join(' ')}>
      <div className="flex min-h-11 items-end justify-between gap-3 border-b border-border px-4 pb-2">
        <h2 id={headingId} className="text-[11px] font-bold uppercase tracking-[.12em] text-fg-muted">{label}</h2>
        {action ? <div className="text-sm">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
```

- [ ] **Step 5: Implement `components/ui/StatusStrip.tsx`**

```tsx
import type { ReactNode } from 'react';

export type StripTone = 'neutral' | 'live' | 'final' | 'drafting' | 'warning';

const TONE: Record<StripTone, string> = {
  neutral: 'border-l-border',
  live: 'border-l-success',
  final: 'border-l-fg-muted',
  drafting: 'border-l-accent',
  warning: 'border-l-warning',
};

/** The one-line "where are we" header of a screen (spec §4.6, §6.5). */
export function StatusStrip({ tone, title, detail, action, switcher }: { tone: StripTone; title: ReactNode; detail?: ReactNode; action?: ReactNode; switcher?: ReactNode }) {
  return (
    <div role="status" className={`-mx-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-b-border border-l-4 bg-surface px-4 py-3 ${TONE[tone]}`}>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 break-words font-display text-[20px] font-bold leading-6 text-fg">
          {tone === 'live' ? (
            <span className="inline-flex items-center gap-1.5 rounded-[4px] bg-success px-1.5 py-0.5 font-body text-[11px] font-bold uppercase tracking-[.1em] text-on-success">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-on-success motion-safe:animate-pulse" />
              LIVE
            </span>
          ) : null}
          {title}
        </p>
        {detail ? <p className="text-[13px] text-fg-muted">{detail}</p> : null}
      </div>
      {switcher}
      {action}
    </div>
  );
}
```

- [ ] **Step 6: Implement `components/ui/Tabs.tsx`** (server-safe)

```tsx
import Link from 'next/link';

export type TabItem = { key: string; label: string; href: string };

/** League tabs on the dark broadcast band (spec §5.3). Scrolls sideways instead of wrapping at 360px. */
export function BandTabs({ items, active, label }: { items: TabItem[]; active: string | null; label: string }) {
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-2 [scrollbar-width:none]">
      <ul className="flex min-w-max">
        {items.map((t) => {
          const on = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={on ? 'page' : undefined}
                className={[
                  'flex min-h-11 cursor-pointer items-center border-b-[3px] px-3 font-display text-[15px] font-semibold uppercase tracking-[.06em]',
                  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  on ? 'border-accent text-on-band' : 'border-transparent text-band-muted hover:text-on-band',
                ].join(' ')}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

`components/ui/PageTabs.tsx` (`'use client'`): `<div role="tablist" aria-label={label} className="-mx-4 flex border-b border-border px-2">`; each item a `<button role="tab" aria-selected={on} tabIndex={on ? 0 : -1}>` with `min-h-11 px-3 text-[15px] font-semibold border-b-2` (`border-fg text-fg` when on, `border-transparent text-fg-muted` otherwise); ArrowLeft/ArrowRight call `onSelect` on the previous/next key and move focus to it. Add a test: renders `role="tablist"` and exactly one `aria-selected="true"`.

- [ ] **Step 7: Implement `components/ui/Sheet.tsx`** (`'use client'`) by extracting the dialog shell from `components/draft/ConfirmSheet.tsx`: import `trappedFocusIndex` from there (do not move it — tests import it from ConfirmSheet). Structure: backdrop `fixed inset-0 z-40 bg-black/50` (click → `onClose`); panel `fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-[28rem] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl`, `role="dialog" aria-modal="true" aria-labelledby={titleId}`; header row with `<h2 id={titleId}>` (font-display 20px) and a close `<button aria-label="Close">` (44px, `X` icon). Effects: focus the panel's first focusable on open; Tab/Shift+Tab trap via `trappedFocusIndex`; Escape → `onClose`; restore focus to `document.activeElement` captured at open. `if (!open) return null;`. Then refactor `ConfirmSheet` to render through `Sheet` only if it stays behavior-identical (its tests must pass unchanged); otherwise leave ConfirmSheet as is.

- [ ] **Step 8: Run** `npx vitest run && npx tsc --noEmit` → green.

- [ ] **Step 9: Commit** — `feat(ux): Row, Section, StatusStrip, tabs and Sheet primitives`.

---

## Phase 2 — Shell and navigation

**Pattern for client components (already used in the repo, e.g. `LeagueMeCardView`/`AppTabBarView`):** export a pure `XView(props)` that renders markup from props, and a thin stateful `X` wrapper that supplies hooks (`usePathname`, `useState`, router). Tests render the `View`.

### Task 4: `lib/nav.ts` rewrite

**Files:**
- Modify: `lib/nav.ts` (full rewrite)
- Create: `tests/nav.test.ts`
- Modify: `tests/ui/shell.test.ts` (delete the `activeTab` describe block — moved to `tests/nav.test.ts` as `leagueTab`)

**Interfaces:**
- Consumes: `LeagueFormat` from `@/lib/db/types` (`'event' | 'season'`).
- Produces:

```ts
export type AppTab = 'home' | 'leagues' | 'you';
export function appTab(pathname: string): AppTab | null;
export type LeagueTab = 'standings' | 'event' | 'draft' | 'admin';
export function leagueTab(pathname: string, slug: string): LeagueTab | null;
export function leagueTabs(format: LeagueFormat, isCommissioner: boolean): LeagueTab[];
export function leagueTabHref(tab: LeagueTab, slug: string, targetRoundId: string | null): string;
export const LEAGUE_TAB_LABEL: Record<LeagueTab, string>; // standings 'Standings', event 'Event', draft 'Draft', admin 'Admin'
export function showLiveDraftPill(pathname: string): boolean;
```

- [ ] **Step 1: Write the failing test** — `tests/nav.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { appTab, leagueTab, leagueTabHref, leagueTabs, showLiveDraftPill } from '@/lib/nav';

describe('appTab', () => {
  it('home is the root only', () => {
    expect(appTab('/')).toBe('home');
  });
  it('leagues covers the list, create, join and every league page', () => {
    for (const p of ['/leagues', '/leagues/new', '/join/ABC123', '/l/fam', '/l/fam/r/1', '/l/fam/r/1/draft', '/l/fam/draft', '/l/fam/admin/r/1']) {
      expect(appTab(p), p).toBe('leagues');
    }
  });
  it('you covers /you and the old settings path', () => {
    expect(appTab('/you')).toBe('you');
    expect(appTab('/you/')).toBe('you');
    expect(appTab('/me/settings')).toBe('you');
  });
  it('is null for sign-in and unknown pages', () => {
    expect(appTab('/signin')).toBeNull();
    expect(appTab('/younger')).toBeNull();
    expect(appTab('/leaguesx')).toBeNull();
  });
});

describe('leagueTab', () => {
  it('maps each league path to its tab', () => {
    expect(leagueTab('/l/fam', 'fam')).toBe('standings');
    expect(leagueTab('/l/fam/', 'fam')).toBe('standings');
    expect(leagueTab('/l/fam/r/abc', 'fam')).toBe('event');
    expect(leagueTab('/l/fam/r/abc/draft', 'fam')).toBe('draft');
    expect(leagueTab('/l/fam/draft', 'fam')).toBe('draft');
    expect(leagueTab('/l/fam/admin', 'fam')).toBe('admin');
    expect(leagueTab('/l/fam/admin/r/abc', 'fam')).toBe('admin');
  });
  it('is null outside this league and matches slugs literally', () => {
    expect(leagueTab('/', 'fam')).toBeNull();
    expect(leagueTab('/l/fam-2', 'fam')).toBeNull();
    expect(leagueTab('/l/fam/administrator', 'fam')).toBeNull();
    expect(leagueTab('/l/a.b', 'a.b')).toBe('standings');
    expect(leagueTab('/l/axb', 'a.b')).toBeNull();
  });
});

describe('leagueTabs', () => {
  it('event leagues have an Event tab; season leagues do not', () => {
    expect(leagueTabs('event', false)).toEqual(['standings', 'event', 'draft']);
    expect(leagueTabs('event', true)).toEqual(['standings', 'event', 'draft', 'admin']);
    expect(leagueTabs('season', false)).toEqual(['standings', 'draft']);
    expect(leagueTabs('season', true)).toEqual(['standings', 'draft', 'admin']);
  });
});

describe('leagueTabHref', () => {
  it('points Event at the target round, or the standings when there is none', () => {
    expect(leagueTabHref('event', 'fam', 'r1')).toBe('/l/fam/r/r1');
    expect(leagueTabHref('event', 'fam', null)).toBe('/l/fam/r/none');
    expect(leagueTabHref('draft', 'fam', 'r1')).toBe('/l/fam/draft');
    expect(leagueTabHref('standings', 'fam', null)).toBe('/l/fam');
    expect(leagueTabHref('admin', 'fam', null)).toBe('/l/fam/admin');
  });
  it('encodes the slug', () => {
    expect(leagueTabHref('standings', 'a b', null)).toBe('/l/a%20b');
  });
});

describe('showLiveDraftPill', () => {
  it('hides on draft pages and the sign-in page only', () => {
    expect(showLiveDraftPill('/')).toBe(true);
    expect(showLiveDraftPill('/l/fam')).toBe(true);
    expect(showLiveDraftPill('/l/fam/draft')).toBe(false);
    expect(showLiveDraftPill('/l/fam/r/1/draft')).toBe(false);
    expect(showLiveDraftPill('/signin')).toBe(false);
  });
});
```

Note on `/l/fam/r/none`: when a league has no rounds, the Event tab still exists (§5.3); it links to the sentinel round id `none`, which the round page renders as the "No events yet" empty state (Task 10). `isUuid('none')` is false, so `loadRoundPage` returns null today — Task 10 handles `roundId === 'none'` before calling it.

- [ ] **Step 2: Run** `npx vitest run tests/nav.test.ts` → FAIL.

- [ ] **Step 3: Implement `lib/nav.ts`**

```ts
import type { LeagueFormat } from '@/lib/db/types';

const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

export type AppTab = 'home' | 'leagues' | 'you';

/** Which bottom-bar tab a path belongs to (spec §5.2). Every league page counts as Leagues. */
export function appTab(pathname: string): AppTab | null {
  const p = trim(pathname);
  if (p === '/') return 'home';
  if (p === '/you' || p === '/me/settings') return 'you';
  if (p === '/leagues' || p.startsWith('/leagues/') || p.startsWith('/join/') || p.startsWith('/l/')) return 'leagues';
  return null;
}

export type LeagueTab = 'standings' | 'event' | 'draft' | 'admin';

export const LEAGUE_TAB_LABEL: Record<LeagueTab, string> = {
  standings: 'Standings',
  event: 'Event',
  draft: 'Draft',
  admin: 'Admin',
};

/** Which league tab a path belongs to, or null outside this league (spec §5.4). */
export function leagueTab(pathname: string, slug: string): LeagueTab | null {
  const base = `/l/${slug}`;
  const p = trim(pathname);
  if (p === base) return 'standings';
  if (!p.startsWith(`${base}/`)) return null;
  const parts = p.slice(base.length + 1).split('/');
  if (parts[0] === 'admin') return 'admin';
  if (parts[0] === 'draft') return 'draft';
  if (parts[0] === 'r') return parts[2] === 'draft' ? 'draft' : 'event';
  return null;
}

/** Full-season leagues have no Event tab: the season is the standings (spec §6.4). */
export function leagueTabs(format: LeagueFormat, isCommissioner: boolean): LeagueTab[] {
  const tabs: LeagueTab[] = format === 'season' ? ['standings', 'draft'] : ['standings', 'event', 'draft'];
  return isCommissioner ? [...tabs, 'admin'] : tabs;
}

export function leagueTabHref(tab: LeagueTab, slug: string, targetRoundId: string | null): string {
  const base = `/l/${encodeURIComponent(slug)}`;
  switch (tab) {
    case 'standings':
      return base;
    case 'event':
      return `${base}/r/${targetRoundId ?? 'none'}`;
    case 'draft':
      return `${base}/draft`;
    case 'admin':
      return `${base}/admin`;
  }
}

/** The live-draft pill steps aside where it would be redundant or in the way (spec §5.5). */
export function showLiveDraftPill(pathname: string): boolean {
  const p = trim(pathname);
  if (p === '/signin') return false;
  return !/^\/l\/[^/]+(\/r\/[^/]+)?\/draft$/.test(p);
}
```

Note: slugs reaching `leagueTab` come from route params (already decoded); `leagueTabHref` encodes for links. Existing tests passed raw slugs like `a.b`; keep that literal-match behavior.

- [ ] **Step 4: Remove old exports' callers.** `activeTab`, `showAppTabBar` and `AppTab = 'me' | 'leagues'` are used by `components/TabBar.tsx`, `components/AppTabBar.tsx`, `components/HeaderAccount.tsx` and `tests/ui/shell.test.ts`/`tests/ui/me.test.ts`. Those components are replaced in Task 5/6 — to keep this task green, temporarily keep thin compatibility exports at the bottom of `lib/nav.ts`:

```ts
/** @deprecated removed in Task 17 — old league TabBar/AppTabBar only. */
export function activeTab(pathname: string, slug: string): 'standings' | 'round' | 'admin' | null {
  const t = leagueTab(pathname, slug);
  return t === 'event' ? 'round' : t === 'draft' ? 'round' : t;
}
/** @deprecated removed in Task 17. */
export function showAppTabBar(pathname: string): boolean {
  return !pathname.startsWith('/l/');
}
```

and update old callers that compare `appTab(...) === 'me'` to `'home'`/`'you'` as appropriate. Move the `activeTab` tests out of `tests/ui/shell.test.ts` (they're superseded by `leagueTab` tests).

- [ ] **Step 5: Run** `npx vitest run && npx tsc --noEmit` → green.

- [ ] **Step 6: Commit** — `feat(ux): navigation rules for the Home/Leagues/You bar and league tabs`.

### Task 5: App shell — BottomBar, AppHeader, `/you`, settings redirect

**Files:**
- Create: `components/shell/BottomBar.tsx`, `components/shell/AppHeader.tsx`, `components/you/AppearanceControl.tsx`, `app/you/page.tsx`, `tests/ui/shell-v3.test.ts`
- Modify: `app/layout.tsx`, `app/me/settings/page.tsx`, `components/SettingsForm.tsx`

**Interfaces:**
- Consumes: `appTab` (Task 4), `Button` (Task 2), icons `Trophy`, `UserRound` + a new `Home` icon added to `components/ui/icons.tsx` (24×24 stroke house, same style as the others).
- Produces:
  - `export function BottomBarView({ pathname }: { pathname: string })`, `export function BottomBar()` (client)
  - `export function AppHeader({ signedIn }: { signedIn: boolean })` (server; band header, logo, "Sign in" button when signed out)
  - `export function AppearanceControlView({ theme, onChange }: { theme: Theme | null; onChange: (t: Theme) => void })`, `export function AppearanceControl()` (client; segmented Light/Dark writing `document.documentElement.dataset.theme` + `localStorage[THEME_STORAGE_KEY]`, same mechanics as `ThemeToggle`)
  - Route `/you`

- [ ] **Step 1: Write the failing tests** — `tests/ui/shell-v3.test.ts`

```ts
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BottomBarView } from '@/components/shell/BottomBar';
import { AppHeader } from '@/components/shell/AppHeader';
import { AppearanceControlView } from '@/components/you/AppearanceControl';

const r = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('BottomBarView', () => {
  it('has Home, Leagues and You, fixed to the bottom with safe-area padding', () => {
    const html = r(h(BottomBarView, { pathname: '/' }));
    expect(html).toContain('aria-label="App"');
    for (const [label, href] of [['Home', '/'], ['Leagues', '/leagues'], ['You', '/you']]) {
      expect(html).toContain(`href="${href}"`);
      expect(html).toContain(label);
    }
    expect(html).toContain('fixed inset-x-0 bottom-0');
    expect(html).toContain('env(safe-area-inset-bottom)');
  });
  it('stays on league pages, with Leagues active', () => {
    const html = r(h(BottomBarView, { pathname: '/l/fam/r/1' }));
    expect(html).toMatch(/href="\/leagues"[^>]*aria-current="page"/);
  });
  it('marks You active on /you', () => {
    expect(r(h(BottomBarView, { pathname: '/you' }))).toMatch(/href="\/you"[^>]*aria-current="page"/);
  });
});

describe('AppHeader', () => {
  it('is the dark band with the wordmark linking home', () => {
    const html = r(h(AppHeader, { signedIn: true }));
    expect(html).toContain('bg-band');
    expect(html).toContain('href="/"');
    expect(html).toContain('FRC FANTASY');
    expect(html).not.toContain('Sign in');
  });
  it('shows Sign in when signed out', () => {
    expect(r(h(AppHeader, { signedIn: false }))).toContain('href="/signin"');
  });
});

describe('AppearanceControlView', () => {
  it('is a two-option radio group with the current theme checked', () => {
    const html = r(h(AppearanceControlView, { theme: 'dark', onChange: () => {} }));
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/aria-checked="true"[^>]*>[^<]*Dark|Dark[\s\S]*aria-checked="true"/);
    expect(html).toContain('Light');
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `BottomBar.tsx`** — copy the structure of `components/AppTabBar.tsx` (`'use client'`, `usePathname`), but: three tabs `{ id: 'home', label: 'Home', href: '/', Icon: Home }`, `{ id: 'leagues', label: 'Leagues', href: '/leagues', Icon: Trophy }`, `{ id: 'you', label: 'You', href: '/you', Icon: UserRound }`; **no** `showAppTabBar` check (always renders); always fixed (`fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]`) at every width — drop the `md:static` desktop pill variant; each link `min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[12px] font-semibold`; active `text-fg` with a 3px `bg-accent` bar on top (`before:` pseudo like today), inactive `text-fg-muted`.

- [ ] **Step 4: Implement `AppHeader.tsx`** — move `Mark` from `app/layout.tsx` into this file. `<header className="sticky top-0 z-30 bg-band text-on-band">` containing the same inner flex row as today (logo link → `/`, `font-display text-2xl font-bold uppercase tracking-wide`), and on the right, when `!signedIn`, `<Button href="/signin" size="sm" variant="accent">Sign in</Button>`. No theme toggle, no avatar.

- [ ] **Step 5: Implement `AppearanceControl.tsx`** — `AppearanceControlView` renders `<div role="radiogroup" aria-label="Appearance" className="inline-flex rounded-lg border border-border p-1">` with two `<button role="radio" aria-checked>` (Light, Dark; `min-h-11 px-4`; checked `bg-fg text-bg`). `theme === null` (before mount) renders both unchecked. `AppearanceControl` mirrors `ThemeToggle`'s effect/try-catch storage logic.

- [ ] **Step 6: `app/you/page.tsx`**

```tsx
import { AppearanceControl } from '@/components/you/AppearanceControl';
import { SettingsForm } from '@/components/SettingsForm';
import { SignInCard } from '@/components/SignInCard';
import { Section } from '@/components/ui/Section';
import { getUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function YouPage() {
  const user = await getUser();
  if (!user) return <SignInCard title="Sign in to see your profile" next="/you" />;
  const profile = await getRepo().getProfile(user.id);
  return (
    <main id="main" className="space-y-8">
      <h1 className="font-display text-[28px] font-bold leading-8 text-fg">You</h1>
      {/* "My season" is added in Task 9 once loadHome exists. */}
      <Section label="Appearance">
        <div className="px-4 py-3"><AppearanceControl /></div>
      </Section>
      <SettingsForm profile={{ displayName: profile?.displayName ?? 'Player', frcTeam: profile?.frcTeam ?? null }} />
    </main>
  );
}
```

Restyle `SettingsForm` into two `Section`s — **Profile** (Display name, "My FRC team (optional)", Save) and **Account** (Sign out; then, separated by `mt-8 border-t pt-6`, the Delete account control with `variant="danger"`). Keep all its logic, field names and API calls. Update its display-name hint to: "Shown in every league. You can also set a different name inside a league from its ⋯ menu."

- [ ] **Step 7: `/me/settings` → redirect.** Replace the page body with `import { redirect } from 'next/navigation'; export const dynamic = 'force-dynamic'; export default function SettingsRedirect() { redirect('/you'); }`. Update `tests/ui/pages.test.ts` / any test that rendered the old settings page.

- [ ] **Step 8: Rewire `app/layout.tsx`.** Replace the inline header with `<AppHeader signedIn={headerUser !== null} />`; replace `<AppTabBar />` with `<BottomBar />` (signed in only, as today); keep `SkipLink`, fonts, theme boot script, footer. Content wrapper: `mx-auto w-full max-w-2xl flex-1 px-4 py-6` plus `pb-28` when signed in (bar + pill clearance), `pb-10` otherwise; drop the `md:` variants that assumed a static desktop bar. `loadHeaderUser` can shrink to a boolean `isSignedIn` (keep its try/catch fail-to-signed-out behavior). `HeaderAccount`/`ThemeToggle` are no longer imported (deleted in Task 17).

- [ ] **Step 9: Run** `npx vitest run && npx tsc --noEmit` → green (fix tests that asserted the old header: `tests/ui/shell.test.ts` HeaderAccount cases move to deletion in Task 17 — mark them `describe.skip` now **only** if the component still exists but is unused; prefer leaving them passing since the component file still exists).

- [ ] **Step 10: Commit** — `feat(ux): Home/Leagues/You bottom bar, band header and You page`.

### Task 6: League header — tabs, switcher, ⋯ menu, `/l/[slug]/draft`

**Files:**
- Create: `components/shell/LeagueHeader.tsx`, `components/shell/LeagueMenu.tsx`, `components/shell/LeagueSwitcher.tsx`, `app/l/[slug]/draft/page.tsx`
- Modify: `app/l/[slug]/layout.tsx`
- Modify: `tests/ui/shell-v3.test.ts` (append)

**Interfaces:**
- Consumes: `leagueTab`, `leagueTabs`, `leagueTabHref`, `LEAGUE_TAB_LABEL` (Task 4); `BandTabs`, `Sheet` (Task 3); `leaveLeague`, `renameMe` from `@/lib/admin/client`; `leaveConfirmText` + `NAME_MAX` (from `LeagueMeCard`/`lib/leagues/names` — move `leaveConfirmText` into `LeagueMenu.tsx` and re-export it from `LeagueMeCard.tsx` until Task 17).
- Produces:

```ts
export type LeagueHeaderProps = {
  slug: string; name: string; format: LeagueFormat;
  isCommissioner: boolean;
  /** Signed-in member of this league (gets ⋯ menu); false for signed-out viewers and watchers. */
  isMember: boolean;
  /** This member's display name in this league (for the rename field); null when not a member. */
  myName: string | null;
  targetRoundId: string | null;
  anyLive: boolean;
  /** Other leagues of the signed-in user, for the switcher; [] hides the chip. */
  myLeagues: { slug: string; name: string }[];
};
export function LeagueHeaderView(p: LeagueHeaderProps & { pathname: string }): JSX.Element;
export function LeagueHeader(p: LeagueHeaderProps): JSX.Element; // client wrapper (usePathname)
```

- [ ] **Step 1: Write the failing tests** (append to `tests/ui/shell-v3.test.ts`)

```ts
import { LeagueHeaderView } from '@/components/shell/LeagueHeader';

const base = {
  slug: 'fam', name: 'Family League', format: 'event' as const, isCommissioner: false, isMember: true,
  myName: 'Joey', targetRoundId: 'r1', anyLive: false, myLeagues: [], pathname: '/l/fam',
};

describe('LeagueHeaderView', () => {
  it('shows the league name on the band with Standings · Event · Draft tabs', () => {
    const html = r(h(LeagueHeaderView, base));
    expect(html).toContain('bg-band');
    expect(html).toContain('Family League');
    expect(html).toContain('href="/l/fam"');
    expect(html).toContain('href="/l/fam/r/r1"');
    expect(html).toContain('href="/l/fam/draft"');
    expect(html).not.toContain('href="/l/fam/admin"');
  });
  it('adds Admin and the Commissioner label for commissioners', () => {
    const html = r(h(LeagueHeaderView, { ...base, isCommissioner: true }));
    expect(html).toContain('href="/l/fam/admin"');
    expect(html).toContain('Commissioner');
  });
  it('season leagues have no Event tab', () => {
    const html = r(h(LeagueHeaderView, { ...base, format: 'season' }));
    expect(html).not.toContain('href="/l/fam/r/r1"');
    expect(html).toContain('href="/l/fam/draft"');
  });
  it('marks the Draft tab active inside the draft room', () => {
    expect(r(h(LeagueHeaderView, { ...base, pathname: '/l/fam/r/r1/draft' }))).toMatch(/href="\/l\/fam\/draft"[^>]*aria-current="page"/);
  });
  it('links Event to the empty-state round when the league has no rounds', () => {
    expect(r(h(LeagueHeaderView, { ...base, targetRoundId: null }))).toContain('href="/l/fam/r/none"');
  });
  it('signed-out viewers get no menu and no switcher', () => {
    const html = r(h(LeagueHeaderView, { ...base, isMember: false, myName: null, myLeagues: [{ slug: 'x', name: 'X' }] }));
    expect(html).not.toContain('aria-label="League menu"');
    expect(html).not.toContain('Switch');
  });
  it('members with other leagues get a Switch chip and the ⋯ menu', () => {
    const html = r(h(LeagueHeaderView, { ...base, myLeagues: [{ slug: 'x', name: 'X' }] }));
    expect(html).toContain('Switch');
    expect(html).toContain('aria-label="League menu"');
  });
  it('truncates a very long league name', () => {
    const html = r(h(LeagueHeaderView, { ...base, name: 'The Extremely Long Habich Family And Friends Fantasy League' }));
    expect(html).toContain('truncate');
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `LeagueHeader.tsx`** (`'use client'`).
  - `LeagueHeaderView` renders `<div className="-mx-4 -mt-6 mb-4 bg-band px-4 pt-3 text-on-band">` (bleeds to the edges under the sticky `AppHeader`; the root content wrapper has `py-6`, hence `-mt-6`).
  - Row 1: `<Link href=/l/slug className="min-w-0 flex-1 truncate font-display text-[22px] font-bold uppercase tracking-[.04em]">{name}</Link>`; live dot (`data-live-dot`, `motion-safe:animate-pulse`, sr-only "A round is live") when `anyLive`; "Commissioner" label (`text-[11px] font-bold uppercase tracking-[.1em] text-secondary` — on the band use `text-[#c4b5fd]`? **No**: use `rounded-[4px] bg-secondary px-1.5 text-on-secondary`); `LeagueSwitcher` chip when `isMember && myLeagues.length > 0`; `LeagueMenu` button when `isMember`.
  - Row 2: `<BandTabs label="League" active={leagueTab(pathname, slug)} items={leagueTabs(format, isCommissioner).map(t => ({ key: t, label: LEAGUE_TAB_LABEL[t], href: leagueTabHref(t, slug, targetRoundId) }))} />`.
  - `LeagueHeader` = `<LeagueHeaderView {...p} pathname={usePathname() ?? `/l/${p.slug}`} />`.

- [ ] **Step 4: Implement `LeagueSwitcher.tsx`** (`'use client'`): a chip button `Switch ▾` (`min-h-11 rounded-full border border-on-band/30 px-3 text-[13px] font-semibold`, `aria-haspopup="dialog"`) opening a `Sheet` titled "Your leagues" listing `myLeagues` as `Row href=/l/{slug}` plus a final `Row href="/leagues" title="All leagues"`.

- [ ] **Step 5: Implement `LeagueMenu.tsx`** (`'use client'`): `⋯` icon button (`aria-label="League menu"`, 44px) opening a `Sheet` titled the league name, containing: (a) "Your name in this league" form (move the rename form + `renameMe` call from `LeagueMeCard`, same validation, `NAME_MAX`, success/danger message), (b) "Copy league link" (`CopyButton` with `${location.origin}/l/${slug}` — compute in an effect, or use `CopyButton` with a relative→absolute helper), (c) "Leave league" `Button variant="danger"` with the same two-step confirm text from `leaveConfirmText(name)` and `leaveLeague` call, then `router.push('/leagues')`. Export a `LeagueMenuView` for tests mirroring `LeagueMeCardView`'s props; move/port `tests/ui/league-me.test.ts` cases to the new view (same behaviors: rename, leave confirm text, busy states).

- [ ] **Step 6: Rewire `app/l/[slug]/layout.tsx`.** Extend `loadShell` (database only — no TBA) to also return `format: league.format`, `isMember` (`access.player !== null`; `LeagueAccess` in `lib/auth/roles.ts` is `{ user, league, player, canView, isCommissioner }`), `myName` (`access.player`'s name in this league — check `PlayerRow`'s name field in `lib/db/types.ts` — or null), and `myLeagues` (if signed in: `repo.listLeaguesForUser(user.id)` minus this league, mapped to `{ slug, name }`; wrap in try/catch → `[]` on failure, Review Focus 5). Replace `<LeagueBar/>` + `<TabBar/>` with `<LeagueHeader {...} />`. Keep the existing error fallback (`return children`) and `canView` behavior.

- [ ] **Step 7: `app/l/[slug]/draft/page.tsx`**

```tsx
import { notFound, redirect } from 'next/navigation';
import { PrivateLeague } from '@/components/PrivateLeague';
import { leagueAccess } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { localDate, roundStatus } from '@/lib/rounds/status';
import { targetRound } from '@/lib/rounds/target';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

/** The Draft tab: jump to the current round's draft (spec §5.1). */
export default async function DraftTabPage({ params }: Props) {
  const { slug } = await params;
  const access = await leagueAccess(slug);
  if (!access) notFound();
  if (!access.canView) return <PrivateLeague signedIn={access.user !== null} next={`/l/${slug}/draft`} />;
  const repo = getRepo();
  const rounds = await repo.listRounds(access.league.id);
  const picks = await repo.listPicksForRounds(rounds.map((r) => r.id));
  const now = new Date();
  const target = targetRound(
    rounds.map((round) => ({ id: round.id, startDate: round.startDate, status: roundStatus(round, picks.filter((p) => p.roundId === round.id).length, now) })),
    localDate(now, rounds[0]?.timezone),
  );
  if (target) redirect(`/l/${encodeURIComponent(slug)}/r/${target}/draft`);
  return (
    <main id="main" className="space-y-4 py-6 text-center">
      <h1 className="font-display text-[24px] font-bold text-fg">No drafts yet</h1>
      <p className="text-fg-muted">When the commissioner adds an event, its draft shows up here.</p>
    </main>
  );
}
```

Extract the shared "statuses + target" computation used by the layout and this page into `lib/rounds/targetFor.ts` (`export function targetFromRows(rounds: RoundRow[], picks: PickRow[], now: Date): string | null`) with a unit test (`tests/rounds/targetFor.test.ts`: no rounds → null; one live round among three → its id), and use it in both places.

- [ ] **Step 8: Run** `npx vitest run && npx tsc --noEmit` → green.

- [ ] **Step 9: Commit** — `feat(ux): league header with top tabs, switcher, menu and Draft tab route`.

### Task 7: App-wide live-draft pill

**Files:**
- Create: `lib/views/liveDrafts.ts`, `components/shell/LiveDraftPill.tsx`, `tests/views/liveDrafts.test.ts`
- Modify: `app/layout.tsx`, `app/l/[slug]/page.tsx`, `app/l/[slug]/r/[roundId]/page.tsx` (remove `LiveDraftBanner`/`memberLiveDrafts` usage)

**Interfaces:**
- Consumes: `repo.listLeaguesForUser(userId)` → `{ league, player }[]`; `repo.listRounds(leagueId)`; `repo.listPicksForRounds(ids)`; `draftPhase`, `onClockPlayer` from `@/lib/draft/live`; `showLiveDraftPill` (Task 4).
- Produces:

```ts
export type MyLiveDraft = { leagueSlug: string; leagueName: string; roundId: string; eventName: string; phase: 'live' | 'paused'; myTurn: boolean };
export async function loadMyLiveDrafts(userId: string): Promise<MyLiveDraft[]>; // sorted: myTurn first, then league name
export function LiveDraftPillView(p: { drafts: MyLiveDraft[]; pathname: string }): JSX.Element | null;
export function LiveDraftPill(p: { drafts: MyLiveDraft[] }): JSX.Element | null; // client wrapper
```

- [ ] **Step 1: Write the failing tests** — `tests/views/liveDrafts.test.ts`. Install the in-memory repo exactly like `tests/views/me.test.ts` does: `const h = vi.hoisted(() => ({ repo: undefined as unknown }));` + `vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));` and `h.repo = createMemoryRepo(...)` from `tests/helpers/memoryRepo.ts` (read that file and `tests/helpers/builders.ts` for how leagues/players/rounds/picks are seeded). Cases:
  1. User in a league whose round has `draftMode: 'live'`, `draftStartedAt` set, 0 picks → one entry, `phase: 'live'`, `myTurn` true when the user's player is first in `draftOrder`.
  2. Paused draft → `phase: 'paused'`.
  3. A `commissioner`-mode round, a not-started live round, and a finished draft → no entries.
  4. Two leagues, one where it's the user's turn → that one is first.
  5. User in no leagues → `[]`.
  And for the view (render tests in the same file with `renderToStaticMarkup`):
  6. `LiveDraftPillView({ drafts: [], pathname: '/' })` → `''`.
  7. One live draft → contains `Draft is live`, the league name, and `href="/l/{slug}/r/{roundId}/draft"`.
  8. `myTurn` → contains `Your pick!`.
  9. On `/l/fam/r/1/draft` → `''`.
  10. Two drafts → contains `+1`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `lib/views/liveDrafts.ts`**

```ts
import { getRepo } from '@/lib/db';
import { draftPhase, onClockPlayer } from '@/lib/draft/live';

export type MyLiveDraft = { leagueSlug: string; leagueName: string; roundId: string; eventName: string; phase: 'live' | 'paused'; myTurn: boolean };

/** Every running draft in the user's leagues, database only (spec §5.5). */
export async function loadMyLiveDrafts(userId: string): Promise<MyLiveDraft[]> {
  const repo = getRepo();
  const memberships = await repo.listLeaguesForUser(userId);
  const perLeague = await Promise.all(
    memberships.map(async ({ league, player }) => {
      const rounds = (await repo.listRounds(league.id)).filter((r) => r.draftMode === 'live' && r.draftStartedAt);
      if (rounds.length === 0) return [];
      const picks = await repo.listPicksForRounds(rounds.map((r) => r.id));
      return rounds.flatMap((round): MyLiveDraft[] => {
        const count = picks.filter((p) => p.roundId === round.id).length;
        const phase = draftPhase(round, count);
        if (phase !== 'live' && phase !== 'paused') return [];
        return [{ leagueSlug: league.slug, leagueName: league.name, roundId: round.id, eventName: round.eventName, phase, myTurn: phase === 'live' && onClockPlayer(round, count) === player.id }];
      });
    }),
  );
  return perLeague.flat().sort((a, b) => Number(b.myTurn) - Number(a.myTurn) || a.leagueName.localeCompare(b.leagueName));
}
```

(Check `onClockPlayer`'s first parameter type in `lib/draft/live.ts` — it takes `{ draftOrder, rosterSize, ... }`; a `RoundRow` satisfies it.)

- [ ] **Step 4: Implement `LiveDraftPill.tsx`** (`'use client'`): `LiveDraftPillView` returns null when `drafts.length === 0 || !showLiveDraftPill(pathname)`. Otherwise a `Link` to the first draft: `fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex min-h-11 max-w-md items-center gap-2 rounded-full bg-accent px-4 text-on-accent shadow-lg font-semibold`; text: `● Your pick! — {league}` / `● Draft is live — {league} · Join` / `Draft paused — {league}`; `+{n-1}` suffix when more than one; dot `motion-safe:animate-pulse`. `LiveDraftPill` = view + `usePathname()`.

- [ ] **Step 5: Wire into `app/layout.tsx`.** When signed in: `const drafts = await loadMyLiveDrafts(user.id).catch((e) => { console.error(e); return []; });` (Review Focus 5) and render `<LiveDraftPill drafts={drafts} />` right before `<BottomBar />`. `loadHeaderUser` must now also return the user id (or call `getUser()` once and reuse).

- [ ] **Step 6: Remove the per-page banner.** In `app/l/[slug]/page.tsx` and `app/l/[slug]/r/[roundId]/page.tsx`, delete `<LiveDraftBanner …/>` and the `memberLiveDrafts` call/import. (Those pages are rebuilt in Tasks 10–11; this keeps the pill the only banner.) Update `tests/ui/pages.test.ts`/`round-components.test.ts` cases that asserted the banner on those pages.

- [ ] **Step 7: Run** `npx vitest run && npx tsc --noEmit` → green.

- [ ] **Step 8: Commit** — `feat(ux): app-wide live-draft pill`.

---

## Phase 3 — Player screens

### Task 8: `upNext`, league status lines, `loadHome`, date helpers

**Files:**
- Create: `lib/views/upNext.ts`, `lib/views/home.ts`, `tests/views/upNext.test.ts`, `tests/views/home.test.ts`
- Modify: `lib/format.ts` (add `shortDate`, `ordinal`), `tests/format.test.ts`

**Interfaces:**
- Consumes: `RoundStatus` (`@/lib/rounds/status`), `DraftPhase`, `draftPhase`, `onClockPlayer` (`@/lib/draft/live`), `loadLeaguePage` (`@/lib/views/league`), `seasonSummary`/`SeasonInput`/`MeSeason` (move from `lib/views/me.ts` into `lib/views/home.ts`; leave `lib/views/me.ts` re-exporting them until Task 17).
- Produces:

```ts
// lib/format.ts
export function shortDate(ymd: string): string;            // '2026-10-24' → 'Oct 24'
export function ordinal(n: number): string;                // 1 → '1st', 2 → '2nd', 3 → '3rd', 4 → '4th', 11 → '11th', 12 → '12th', 13 → '13th', 21 → '21st', 22 → '22nd', 101 → '101st', 111 → '111th'

// lib/views/upNext.ts
export type UpNextInput = {
  leagueSlug: string; leagueName: string;
  roundId: string; eventName: string; startDate: string; endDate: string;
  status: RoundStatus; draftMode: 'live' | 'commissioner'; draftPhase: DraftPhase; myTurn: boolean;
  myRank: number | null; myPoints: number | null; winnerName: string | null; myTeams: string[];
};
export type UpNextKind = 'draft-live' | 'event-live' | 'results' | 'event-soon' | 'draft-soon';
export type UpNext = { kind: UpNextKind; item: UpNextInput } | null;
export function upNext(items: UpNextInput[], today: string): UpNext;
export function leagueStatusLine(view: { eventName: string; status: RoundStatus; startDate: string } | null): string;

// lib/views/home.ts
export type HomeLeague = { slug: string; name: string; isCommissioner: boolean; rank: number | null; total: number; line: string; error: boolean };
export type HomePage = { leagues: HomeLeague[]; upNext: UpNext; season: MeSeason };
export async function loadHome(userId: string, now: Date): Promise<HomePage>;
```

- [ ] **Step 1: Write the failing tests** — `tests/views/upNext.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { leagueStatusLine, upNext, type UpNextInput } from '@/lib/views/upNext';

const item = (o: Partial<UpNextInput>): UpNextInput => ({
  leagueSlug: 'fam', leagueName: 'Family', roundId: 'r', eventName: 'Ramp Riot',
  startDate: '2026-10-24', endDate: '2026-10-24', status: 'upcoming', draftMode: 'live',
  draftPhase: 'done', myTurn: false, myRank: null, myPoints: null, winnerName: null, myTeams: [], ...o,
});
const TODAY = '2026-10-20';

describe('upNext', () => {
  it('is null with nothing going on', () => {
    expect(upNext([], TODAY)).toBeNull();
    expect(upNext([item({ status: 'final', endDate: '2026-01-01' })], TODAY)).toBeNull();
  });
  it('a live draft beats everything, and my turn beats other live drafts', () => {
    const items = [
      item({ roundId: 'live', status: 'live' }),
      item({ roundId: 'd1', leagueName: 'A', status: 'drafting', draftPhase: 'live' }),
      item({ roundId: 'd2', leagueName: 'B', status: 'drafting', draftPhase: 'live', myTurn: true }),
    ];
    expect(upNext(items, TODAY)).toEqual({ kind: 'draft-live', item: items[2] });
  });
  it('a paused draft still counts as a live draft', () => {
    const i = item({ status: 'drafting', draftPhase: 'paused' });
    expect(upNext([i], TODAY)?.kind).toBe('draft-live');
  });
  it('a live event beats recent results and upcoming events', () => {
    const items = [item({ roundId: 'u' }), item({ roundId: 'f', status: 'final', endDate: '2026-10-19' }), item({ roundId: 'l', status: 'live' })];
    expect(upNext(items, TODAY)?.item.roundId).toBe('l');
  });
  it('shows results for 3 days after the event ends, most recent first', () => {
    const a = item({ roundId: 'a', status: 'final', endDate: '2026-10-17' });
    const b = item({ roundId: 'b', status: 'awaiting_final', endDate: '2026-10-18' });
    expect(upNext([a, b], TODAY)).toEqual({ kind: 'results', item: b });
    expect(upNext([item({ status: 'final', endDate: '2026-10-16' })], TODAY)).toBeNull();
  });
  it('then the soonest upcoming event, then the soonest draft to come', () => {
    const later = item({ roundId: 'later', startDate: '2026-11-01', endDate: '2026-11-01' });
    const sooner = item({ roundId: 'sooner', startDate: '2026-10-25', endDate: '2026-10-25' });
    expect(upNext([later, sooner], TODAY)).toEqual({ kind: 'event-soon', item: sooner });
    const setup = item({ roundId: 's', status: 'setup', draftPhase: 'setup' });
    expect(upNext([setup], TODAY)).toEqual({ kind: 'draft-soon', item: setup });
  });
  it('ignores drafts for events that already ended', () => {
    expect(upNext([item({ status: 'setup', draftPhase: 'setup', endDate: '2026-10-01' })], TODAY)).toBeNull();
  });
  it('breaks ties by start date, then league name', () => {
    const b = item({ roundId: 'b', leagueName: 'B', status: 'live' });
    const a = item({ roundId: 'a', leagueName: 'A', status: 'live' });
    expect(upNext([b, a], TODAY)?.item.roundId).toBe('a');
  });
});

describe('leagueStatusLine', () => {
  it('says what the most relevant round is doing', () => {
    expect(leagueStatusLine(null)).toBe('No events yet');
    expect(leagueStatusLine({ eventName: 'Ramp Riot', status: 'setup', startDate: '2026-10-24' })).toBe('Ramp Riot · draft not set up');
    expect(leagueStatusLine({ eventName: 'Ramp Riot', status: 'drafting', startDate: '2026-10-24' })).toBe('Ramp Riot · drafting');
    expect(leagueStatusLine({ eventName: 'Ramp Riot', status: 'upcoming', startDate: '2026-10-24' })).toBe('Ramp Riot · starts Oct 24');
    expect(leagueStatusLine({ eventName: 'Ramp Riot', status: 'live', startDate: '2026-10-24' })).toBe('Ramp Riot · live now');
    expect(leagueStatusLine({ eventName: 'Ramp Riot', status: 'awaiting_final', startDate: '2026-10-24' })).toBe('Ramp Riot · event over');
    expect(leagueStatusLine({ eventName: 'Ramp Riot', status: 'final', startDate: '2026-10-24' })).toBe('Ramp Riot · final');
  });
});
```

Append to `tests/format.test.ts`:

```ts
import { ordinal, shortDate } from '@/lib/format';
describe('shortDate / ordinal', () => {
  it('formats dates without timezone drift', () => {
    expect(shortDate('2026-10-24')).toBe('Oct 24');
    expect(shortDate('2026-01-01')).toBe('Jan 1');
  });
  it('handles English ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
  });
});
```

(Merge the import into the file's existing import from `@/lib/format`.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement the helpers in `lib/format.ts`**

```ts
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' → 'Oct 24', read as a calendar date (no timezone shift). */
export function shortDate(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}
```

- [ ] **Step 4: Implement `lib/views/upNext.ts`**

```ts
import type { DraftPhase } from '@/lib/draft/live';
import { shortDate } from '@/lib/format';
import { addDays, type RoundStatus } from '@/lib/rounds/status';

export type UpNextInput = {
  leagueSlug: string; leagueName: string;
  roundId: string; eventName: string; startDate: string; endDate: string;
  status: RoundStatus; draftMode: 'live' | 'commissioner'; draftPhase: DraftPhase; myTurn: boolean;
  myRank: number | null; myPoints: number | null; winnerName: string | null; myTeams: string[];
};
export type UpNextKind = 'draft-live' | 'event-live' | 'results' | 'event-soon' | 'draft-soon';
export type UpNext = { kind: UpNextKind; item: UpNextInput } | null;

const byStartThenLeague = (a: UpNextInput, b: UpNextInput) =>
  a.startDate.localeCompare(b.startDate) || a.leagueName.localeCompare(b.leagueName);

/** The single most useful thing to show on Home, across all the user's leagues (spec §8.1). */
export function upNext(items: UpNextInput[], today: string): UpNext {
  const first = (kind: UpNextKind, list: UpNextInput[], order = byStartThenLeague): UpNext =>
    list.length > 0 ? { kind, item: [...list].sort(order)[0] } : null;

  const drafting = items.filter((i) => i.draftPhase === 'live' || i.draftPhase === 'paused');
  if (drafting.length > 0) {
    return first('draft-live', drafting, (a, b) => Number(b.myTurn) - Number(a.myTurn) || byStartThenLeague(a, b));
  }
  const live = first('event-live', items.filter((i) => i.status === 'live'));
  if (live) return live;
  const results = first(
    'results',
    items.filter((i) => (i.status === 'final' || i.status === 'awaiting_final') && today <= addDays(i.endDate, 3)),
    (a, b) => b.endDate.localeCompare(a.endDate) || a.leagueName.localeCompare(b.leagueName),
  );
  if (results) return results;
  const soon = first('event-soon', items.filter((i) => i.status === 'upcoming'));
  if (soon) return soon;
  return first('draft-soon', items.filter((i) => (i.status === 'setup' || i.status === 'drafting') && i.endDate >= today));
}

const PHRASE: Record<RoundStatus, (startDate: string) => string> = {
  setup: () => 'draft not set up',
  drafting: () => 'drafting',
  upcoming: (d) => `starts ${shortDate(d)}`,
  live: () => 'live now',
  awaiting_final: () => 'event over',
  final: () => 'final',
};

/** "Ramp Riot · drafting" — the one-line status under a league's name (spec §6.1). */
export function leagueStatusLine(view: { eventName: string; status: RoundStatus; startDate: string } | null): string {
  if (!view) return 'No events yet';
  return `${view.eventName} · ${PHRASE[view.status](view.startDate)}`;
}
```

- [ ] **Step 5: Implement `lib/views/home.ts`.** Move `SeasonInput`, `MeSeason`, `seasonSummary` here verbatim from `lib/views/me.ts` (and make `me.ts` re-export them so `tests/views/me.test.ts` keeps compiling until Task 17). Then:

```ts
export type HomeLeague = { slug: string; name: string; isCommissioner: boolean; rank: number | null; total: number; line: string; error: boolean };
export type HomePage = { leagues: HomeLeague[]; upNext: UpNext; season: MeSeason };

/** Everything Home and You show. Leagues load in parallel; one failing league doesn't break the page. */
export async function loadHome(userId: string, now: Date): Promise<HomePage> {
  const memberships = await getRepo().listLeaguesForUser(userId);
  const results = await Promise.allSettled(memberships.map((m) => loadLeaguePage(m.league.slug, now)));
  const today = localDate(now, 'America/New_York');
  const leagues: HomeLeague[] = [];
  const items: UpNextInput[] = [];
  const seasonRounds: SeasonInput[] = [];

  memberships.forEach(({ league, player }, i) => {
    const base = { slug: league.slug, name: league.name, isCommissioner: player.role === 'commissioner' };
    const result = results[i];
    if (result.status === 'rejected' || result.value === null) {
      if (result.status === 'rejected') console.error(result.reason);
      leagues.push({ ...base, rank: null, total: 0, line: "Couldn't load", error: true });
      return;
    }
    const page = result.value;
    const row = page.standings.find((s) => s.playerId === player.id);
    const targetId = targetRound(page.rounds.map((v) => ({ id: v.round.id, startDate: v.round.startDate, status: v.status })), today);
    const target = page.rounds.find((v) => v.round.id === targetId) ?? null;
    leagues.push({
      ...base,
      rank: row?.rank ?? null,
      total: row?.total ?? 0,
      line: leagueStatusLine(target && { eventName: target.round.eventName, status: target.status, startDate: target.round.startDate }),
      error: false,
    });
    for (const view of page.rounds) {
      const me = view.scores.find((s) => s.playerId === player.id) ?? null;
      const winner = view.scores.find((s) => s.rank === 1) ?? null;
      items.push({
        leagueSlug: league.slug, leagueName: league.name,
        roundId: view.round.id, eventName: view.round.eventName,
        startDate: view.round.startDate, endDate: view.round.endDate,
        status: view.status, draftMode: view.round.draftMode,
        draftPhase: draftPhase(view.round, view.picks.length),
        myTurn: onClockPlayer(view.round, view.picks.length) === player.id && draftPhase(view.round, view.picks.length) === 'live',
        myRank: me?.rank ?? null, myPoints: me?.total ?? null,
        winnerName: winner?.name ?? null,
        myTeams: view.picks.filter((p) => p.playerId === player.id).sort((a, b) => a.pickNumber - b.pickNumber).map((p) => p.teamKey),
      });
      seasonRounds.push({
        eventName: view.round.eventName,
        startDate: view.round.startDate,
        finalized: view.round.finalizedAt !== null,
        me: me && { total: me.total, rank: me.rank, teams: me.teams.map((t) => ({ teamKey: t.teamKey, total: t.total })) },
      });
    }
  });
  return { leagues, upNext: upNext(items, today), season: seasonSummary(seasonRounds, today.slice(0, 4)) };
}
```

(Check `PickRow`'s pick-number field name in `lib/db/types.ts` and `RoundRow.draftMode`'s type; adjust.)

Write `tests/views/home.test.ts` modeled on the `loadMePage` tests in `tests/views/me.test.ts` (same `vi.hoisted` repo + `getTba` mocks and seeding helpers): (1) zero leagues → `{ leagues: [], upNext: null }` and season total 0; (2) one league with an upcoming round → a league row with `line` `"{event} · starts {Mon D}"` and `upNext.kind === 'event-soon'` with `myTeams` in pick order; (3) a league whose page load throws → `error: true`, `line: "Couldn't load"`, other leagues still present.

- [ ] **Step 6: Run** `npx vitest run && npx tsc --noEmit` → green.

- [ ] **Step 7: Commit** — `feat(ux): upNext priority, league status lines and the Home loader`.

### Task 9: Home, Leagues and You pages

**Files:**
- Create: `components/home/UpNextCard.tsx`, `components/you/MySeason.tsx`, `tests/ui/home.test.ts`
- Modify: `app/page.tsx`, `app/leagues/page.tsx`, `app/you/page.tsx`, `components/me/LeagueRows.tsx`, `components/InviteCodeBox.tsx` (restyle only)

**Interfaces:**
- Consumes: `loadHome`, `HomeLeague`, `UpNext` (Task 8); `Row`, `Section`, `RankNumeral`, `Points` (Task 3); `Button`, `BumperPlate`; `shortDate`, `ordinal`; `teamLabel` from `@/lib/teams` (team key → number shown on plate).
- Produces:
  - `export function UpNextCard({ next }: { next: UpNext }): JSX.Element` (server)
  - `export function upNextCopy(next: Exclude<UpNext, null>): { eyebrow: string; title: string; detail: string; action: { label: string; href: string } | null }` (pure, exported for tests)
  - `export function LeagueRows({ leagues }: { leagues: HomeLeague[] })` (server; replaces the old props)
  - `export function MySeason({ season, year }: { season: MeSeason; year: string })`

- [ ] **Step 1: Write the failing tests** — `tests/ui/home.test.ts`

```ts
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UpNextCard, upNextCopy } from '@/components/home/UpNextCard';
import { LeagueRows } from '@/components/me/LeagueRows';
import { MySeason } from '@/components/you/MySeason';
import type { UpNextInput } from '@/lib/views/upNext';

const item = (o: Partial<UpNextInput>): UpNextInput => ({
  leagueSlug: 'fam', leagueName: 'Family', roundId: 'r1', eventName: 'Ramp Riot',
  startDate: '2026-10-24', endDate: '2026-10-24', status: 'upcoming', draftMode: 'live',
  draftPhase: 'done', myTurn: false, myRank: null, myPoints: null, winnerName: null, myTeams: [], ...o,
});
const r = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('upNextCopy', () => {
  it('live draft, my turn', () => {
    const c = upNextCopy({ kind: 'draft-live', item: item({ draftPhase: 'live', myTurn: true }) });
    expect(c.title).toBe('Your pick!');
    expect(c.action).toEqual({ label: 'Open draft room', href: '/l/fam/r/r1/draft' });
  });
  it('live draft, someone else / paused', () => {
    expect(upNextCopy({ kind: 'draft-live', item: item({ draftPhase: 'live' }) }).title).toBe('Draft is live');
    expect(upNextCopy({ kind: 'draft-live', item: item({ draftPhase: 'paused' }) }).title).toBe('Draft paused');
  });
  it('live event with and without a rank', () => {
    const c = upNextCopy({ kind: 'event-live', item: item({ status: 'live', myRank: 2, myPoints: 198 }) });
    expect(c.title).toBe("You're 2nd at Ramp Riot");
    expect(c.detail).toBe('198 pts · Family');
    expect(c.action).toEqual({ label: 'See scores', href: '/l/fam/r/r1' });
    expect(upNextCopy({ kind: 'event-live', item: item({ status: 'live' }) }).title).toBe('Ramp Riot is live');
  });
  it('results with a medal for the podium', () => {
    const c = upNextCopy({ kind: 'results', item: item({ status: 'final', myRank: 1, winnerName: 'Joey' }) });
    expect(c.title).toBe('You finished 1st at Ramp Riot 🥇');
    expect(c.detail).toBe('Joey won · Family');
    expect(upNextCopy({ kind: 'results', item: item({ status: 'final', myRank: 4, winnerName: 'Mom' }) }).title).toBe('You finished 4th at Ramp Riot');
  });
  it('event soon and draft soon', () => {
    expect(upNextCopy({ kind: 'event-soon', item: item({}) }).title).toBe('Ramp Riot starts Oct 24');
    const d = upNextCopy({ kind: 'draft-soon', item: item({ status: 'setup', draftPhase: 'setup' }) });
    expect(d.title).toBe('Ramp Riot draft coming up');
    expect(d.detail).toBe('Oct 24 · Family');
    expect(d.action?.href).toBe('/l/fam/r/r1/draft');
  });
});

describe('UpNextCard', () => {
  it('renders the empty state when there is nothing', () => {
    expect(r(h(UpNextCard, { next: null }))).toContain('Nothing on right now');
  });
  it('shows your teams as blue plates for an upcoming event', () => {
    const html = r(h(UpNextCard, { next: { kind: 'event-soon', item: item({ myTeams: ['frc5181', 'frc2539'] }) } }));
    expect(html).toContain('Team 5181');
    expect(html).toContain('Team 2539');
    expect(html).not.toContain('bg-red-alliance');
  });
});

describe('LeagueRows', () => {
  it('links each league with its status line and rank', () => {
    const html = r(h(LeagueRows, { leagues: [
      { slug: 'fam', name: 'Family', isCommissioner: true, rank: 2, total: 198, line: 'Ramp Riot · live now', error: false },
      { slug: 'x', name: 'Broken', isCommissioner: false, rank: null, total: 0, line: "Couldn't load", error: true },
    ] }));
    expect(html).toContain('href="/l/fam"');
    expect(html).toContain('Ramp Riot · live now');
    expect(html).toContain('#2');
    expect(html).toContain('Commissioner');
    expect(html).toContain('Couldn&#x27;t load');
  });
});

describe('MySeason', () => {
  it('labels every number', () => {
    const html = r(h(MySeason, { year: '2026', season: { total: 1284, bestPick: { teamKey: 'frc341', eventName: 'Ramp Riot', points: 62 }, averageFinish: 2.3 } }));
    expect(html).toContain('1,284');
    expect(html).toContain('points in 2026');
    expect(html).toContain('Best pick');
    expect(html).toContain('341 at Ramp Riot');
    expect(html).toContain('Average finish');
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `UpNextCard.tsx`.** `upNextCopy` per spec §6.1 table exactly (eyebrow = `UP NEXT · {LEAGUE NAME}` uppercased; medals 🥇🥈🥉 for ranks 1–3; draft hrefs `/l/{slug}/r/{roundId}/draft`, event hrefs `/l/{slug}/r/{roundId}`; `event-soon` action `{ label: 'See your teams', href: event href }`; when `myRank` is null for `results`, title `"{event} is final"` and detail `"{winner} won · {league}"`). `UpNextCard` renders a `rounded-card border border-accent bg-surface p-4` card: eyebrow (`text-[11px] font-bold uppercase tracking-[.12em] text-accent-text`), title (`font-display text-[28px] font-bold leading-8`), detail (`text-fg-muted`), plates (`BumperPlate size="sm"` with `teamLabel(key)`) for `event-soon` and `draft-soon` when `myTeams` non-empty, and the action as `Button variant="accent"` full width. `next === null` → the card with title "Nothing on right now" and detail "Your next event will show up here."

- [ ] **Step 4: Rewrite `LeagueRows.tsx`** to take `HomeLeague[]` and render one `Row` per league: `href=/l/{slug}`, `title=name` (+ Commissioner label as in Task 6), `subtitle=line`, `trailing` = `#{rank}` in `font-display text-[22px] font-bold` or `—`. Error rows: no href, subtitle "Couldn't load". Wrap in nothing (callers wrap in `Section`). Update `tests/ui/me.test.ts` cases for LeagueRows to the new props (or delete those cases if covered above).

- [ ] **Step 5: `MySeason.tsx`** — three `Row`s: "{total formatted with toLocaleString('en-US')} points in {year}"; "Best pick" with subtitle `"{number} at {event} (+{points})"` or "—"; "Average finish" with trailing `averageFinish.toFixed(1)` or "—".

- [ ] **Step 6: `app/page.tsx`** — signed out unchanged (Landing). Signed in: `const home = await loadHome(user.id, new Date())`; render:

```tsx
<main id="main" className="space-y-8">
  {home.upNext && (home.upNext.kind === 'event-live' || home.upNext.kind === 'draft-live') ? <AutoRefresh seconds={60} /> : null}
  {home.leagues.length === 0 ? (
    <div className="space-y-4 rounded-card border border-accent bg-surface p-4">
      <h1 className="font-display text-[28px] font-bold leading-8">Welcome!</h1>
      <p className="text-fg-muted">Join your family&apos;s league with the invite code, or start one.</p>
      <InviteCodeBox label="Have an invite code?" />
      <Button href="/leagues/new" variant="secondary" className="w-full">Create a league</Button>
    </div>
  ) : (
    <>
      <h1 className="sr-only">Home</h1>
      <UpNextCard next={home.upNext} />
      <Section label="Your leagues"><LeagueRows leagues={home.leagues} /></Section>
    </>
  )}
</main>
```

Keep whatever error handling `app/page.tsx` has today around the loader (DbAsleep etc.).

- [ ] **Step 7: `app/leagues/page.tsx`** — `h1` "Leagues"; `Section label="Your leagues"` with `LeagueRows` (from `loadHome(...).leagues`), or "You're not in any leagues yet." when empty; then `Button href="/leagues/new"` "Create a league" and a `Section label="Join with a code"` holding `InviteCodeBox`. Restyle `InviteCodeBox` to the new input/button styles (logic unchanged).

- [ ] **Step 8: `/you`** — insert `<Section label="My season"><MySeason season={home.season} year={...} /></Section>` above Appearance, loading `loadHome(user.id, now)` (wrap in try/catch: on failure omit the section).

- [ ] **Step 9: Run** `npx vitest run && npx tsc --noEmit` → green. `components/me/MeHome.tsx` is now unused (deleted in Task 17).

- [ ] **Step 10: Commit** — `feat(ux): Home up-next card, Leagues list and My season on You`.

### Task 10: Event tab — status strip, expandable leaderboard, switcher, scoring sheet

**Files:**
- Create: `lib/views/roundStrip.ts`, `lib/views/scoringSummary.ts` (not under `lib/scoring`, which is read-only), `components/event/PlayerBoard.tsx`, `components/event/EventSwitcher.tsx`, `components/event/ScoringSheet.tsx`, `components/event/EventBody.tsx`, `tests/views/roundStrip.test.ts`, `tests/views/scoringSummary.test.ts`, `tests/ui/event.test.ts`
- Modify: `app/l/[slug]/r/[roundId]/page.tsx` (rewrite), `components/AdjustmentList.tsx` (restyle to rows)

**Interfaces:**
- Consumes: `RoundView`, `loadRoundPage` (`lib/views/round.ts`); `freshnessText`, `formatDateRange`, `shortDate`, `lineText`, `tbaEventUrl`, `teamName` (`lib/format.ts`); `teamLabel` (`lib/teams.ts`); `StatusStrip`, `StripTone`, `Row`, `RankNumeral`, `Points`, `Section`, `Sheet`, `BumperPlate`, `InfoTip`, `GLOSSARY`; `ScoringConfig`, `DEFAULT_SCORING` (`lib/scoring/config.ts`); `SeasonTeamDetail`, `SeasonEventScore` (`lib/season/score.ts`); `seasonEventLabel` (move from `components/RosterList.tsx` into `PlayerBoard.tsx`; RosterList re-exports it until Task 17).
- Produces:

```ts
// lib/views/roundStrip.ts
export type StripInput = {
  slug: string; roundId: string; eventName: string; startDate: string; endDate: string;
  status: RoundStatus; kind: RoundKind; fetchedAt: string | null; stale: boolean; winnerName: string | null;
};
export type Strip = { tone: StripTone; title: string; detail: string | null; action: { label: string; href: string } | null };
export function roundStrip(input: StripInput, now: Date): Strip;

// lib/views/scoringSummary.ts
export function scoringSummary(config: ScoringConfig): string[]; // plain-English lines, e.g. "Each qualification win: 2 pts"

// components/event/PlayerBoard.tsx
export type PlayerBoardProps = {
  scores: PlayerRoundScore[]; meId: string | null; teamNames: Record<string, string>;
  status: RoundStatus; season: Record<string, SeasonTeamDetail> | null;
};
export function PlayerBoard(p: PlayerBoardProps): JSX.Element;
export function seasonEventLabel(e: SeasonEventScore): string;

// components/event/EventSwitcher.tsx ('use client')
export function EventSwitcher(p: { slug: string; currentId: string; currentName: string; rounds: { id: string; eventName: string; startDate: string }[]; tbaUrl: string | null }): JSX.Element | null;

// components/event/ScoringSheet.tsx ('use client')
export function ScoringSheet(p: { lines: string[] }): JSX.Element;

// components/event/EventBody.tsx (server) — shared by the Event tab and season-league Standings
export type EventBodyProps = {
  slug: string; view: RoundView; rounds: { id: string; eventName: string; startDate: string }[];
  meId: string | null; playerNames: Record<string, string>; now: Date;
};
export function EventBody(p: EventBodyProps): JSX.Element;
```

- [ ] **Step 1: Write the failing tests** — `tests/views/roundStrip.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { freshnessText } from '@/lib/format';
import { roundStrip, type StripInput } from '@/lib/views/roundStrip';

const NOW = new Date('2026-10-24T15:00:00Z');
const base: StripInput = {
  slug: 'fam', roundId: 'r1', eventName: 'Ramp Riot', startDate: '2026-10-24', endDate: '2026-10-24',
  status: 'live', kind: 'tba', fetchedAt: '2026-10-24T14:59:00Z', stale: false, winnerName: null,
};

describe('roundStrip', () => {
  it('setup', () => {
    expect(roundStrip({ ...base, status: 'setup' }, NOW)).toMatchObject({ tone: 'neutral', title: 'Draft not set up yet', action: null });
  });
  it('drafting points at the draft room', () => {
    expect(roundStrip({ ...base, status: 'drafting' }, NOW)).toMatchObject({
      tone: 'drafting', title: 'Draft in progress', action: { label: 'Open draft room', href: '/l/fam/r/r1/draft' },
    });
  });
  it('upcoming names the start date', () => {
    expect(roundStrip({ ...base, status: 'upcoming' }, NOW).title).toBe('Starts Oct 24');
  });
  it('live shows freshness from TBA', () => {
    const s = roundStrip(base, NOW);
    expect(s.tone).toBe('live');
    expect(s.title).toBe('Ramp Riot');
    expect(s.detail).toBe(freshnessText('2026-10-24T14:59:00Z', false, NOW));
  });
  it('manual rounds say who enters scores instead of TBA freshness', () => {
    expect(roundStrip({ ...base, kind: 'manual' }, NOW).detail).toBe('Scores entered by the commissioner');
  });
  it('awaiting final warns results may change', () => {
    expect(roundStrip({ ...base, status: 'awaiting_final' }, NOW)).toMatchObject({ tone: 'final', title: 'Event over · results may still change' });
  });
  it('final names the winner', () => {
    expect(roundStrip({ ...base, status: 'final', winnerName: 'Mom' }, NOW).title).toBe('Final · Mom wins');
    expect(roundStrip({ ...base, status: 'final' }, NOW).title).toBe('Final');
  });
  it('encodes the slug in links', () => {
    expect(roundStrip({ ...base, slug: 'a b', status: 'drafting' }, NOW).action?.href).toBe('/l/a%20b/r/r1/draft');
  });
});
```

`tests/views/scoringSummary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { scoringSummary } from '@/lib/views/scoringSummary';

/** Adds 7 to the first numeric leaf (depth-first), so the test doesn't hard-code the config shape. */
function bumpFirstNumber(o: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'number' && v > 0) { o[k] = v + 7; return true; }
    if (Array.isArray(v) && typeof v[0] === 'number') { (v as number[])[0] += 7; return true; }
    if (v && typeof v === 'object' && bumpFirstNumber(v as Record<string, unknown>)) return true;
  }
  return false;
}

describe('scoringSummary', () => {
  it('describes the scoring rules in plain words', () => {
    const lines = scoringSummary(DEFAULT_SCORING);
    expect(lines.length).toBeGreaterThanOrEqual(6);
    for (const l of lines) {
      expect(l).toMatch(/\bpts?\b/);
      expect(l).not.toMatch(/\bRP\b/);
    }
  });
  it('reflects a changed value', () => {
    const before = scoringSummary(DEFAULT_SCORING).join('\n');
    const changed = structuredClone(DEFAULT_SCORING);
    expect(bumpFirstNumber(changed as unknown as Record<string, unknown>)).toBe(true);
    expect(scoringSummary(changed).join('\n')).not.toBe(before);
  });
});
```

`tests/ui/event.test.ts` (PlayerBoard):

```ts
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlayerBoard } from '@/components/event/PlayerBoard';
import type { PlayerRoundScore } from '@/lib/scoring/types';

const p = (playerId: string, name: string, rank: number, total: number, teams: string[] = []): PlayerRoundScore => ({
  playerId, name, rank, total, adjustments: [],
  teams: teams.map((teamKey, i) => ({ teamKey, total: 10 * (i + 1), lines: [{ label: 'Qual wins', points: 10 * (i + 1) }] })),
});
const scores = [p('a', 'Mom', 1, 212, ['frc254']), p('b', 'Joey', 2, 198, ['frc5181', 'frc2539']), p('c', 'Grandpa (left)', 3, 150)];
const r = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('PlayerBoard', () => {
  it('one row per player with rank and points; yours is open and highlighted', () => {
    const html = r(h(PlayerBoard, { scores, meId: 'b', teamNames: { frc5181: 'Bagel Bytes' }, status: 'live', season: null }));
    expect(html.match(/<details/g)?.length).toBe(3);
    expect(html).toMatch(/<details[^>]*open=""[^>]*>[\s\S]*Joey/);
    expect(html).toContain('(you)');
    expect(html).toContain('212');
    expect(html).toContain('Team 5181');
    expect(html).toContain('Bagel Bytes');
  });
  it('never highlights anyone for a signed-out viewer', () => {
    const html = r(h(PlayerBoard, { scores, meId: null, teamNames: {}, status: 'live', season: null }));
    expect(html).not.toContain('(you)');
    expect(html).not.toContain(' open=""');
    expect(html).not.toContain('var(--color-primary-fill)');
  });
  it('shows dashes instead of zeros before the event', () => {
    const html = r(h(PlayerBoard, { scores: [p('a', 'Mom', 1, 0, ['frc254'])], meId: null, teamNames: {}, status: 'upcoming', season: null }));
    expect(html).toContain('—');
  });
  it('a player with no teams says so', () => {
    expect(r(h(PlayerBoard, { scores, meId: null, teamNames: {}, status: 'live', season: null }))).toContain('No teams yet');
  });
  it('plates are blue', () => {
    expect(r(h(PlayerBoard, { scores, meId: 'b', teamNames: {}, status: 'live', season: null }))).not.toContain('bg-red-alliance');
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `lib/views/roundStrip.ts`**

```ts
import type { StripTone } from '@/components/ui/StatusStrip';
import type { RoundKind } from '@/lib/db/types';
import { formatDateRange, freshnessText, shortDate } from '@/lib/format';
import type { RoundStatus } from '@/lib/rounds/status';

export type StripInput = {
  slug: string; roundId: string; eventName: string; startDate: string; endDate: string;
  status: RoundStatus; kind: RoundKind; fetchedAt: string | null; stale: boolean; winnerName: string | null;
};
export type Strip = { tone: StripTone; title: string; detail: string | null; action: { label: string; href: string } | null };

/** What the top of the Event tab says for each round status (spec §6.5). */
export function roundStrip(i: StripInput, now: Date): Strip {
  const dates = formatDateRange(i.startDate, i.endDate);
  const fresh = i.kind === 'manual' ? 'Scores entered by the commissioner' : freshnessText(i.fetchedAt, i.stale, now);
  const draftHref = `/l/${encodeURIComponent(i.slug)}/r/${i.roundId}/draft`;
  switch (i.status) {
    case 'setup':
      return { tone: 'neutral', title: 'Draft not set up yet', detail: dates, action: null };
    case 'drafting':
      return { tone: 'drafting', title: 'Draft in progress', detail: dates, action: { label: 'Open draft room', href: draftHref } };
    case 'upcoming':
      return { tone: 'neutral', title: `Starts ${shortDate(i.startDate)}`, detail: dates, action: null };
    case 'live':
      return { tone: 'live', title: i.eventName, detail: fresh, action: null };
    case 'awaiting_final':
      return { tone: 'final', title: 'Event over · results may still change', detail: fresh, action: null };
    case 'final':
      return { tone: 'final', title: i.winnerName ? `Final · ${i.winnerName} wins` : 'Final', detail: dates, action: null };
  }
}
```

- [ ] **Step 4: Implement `lib/views/scoringSummary.ts`.** Read `lib/scoring/config.ts` (`scoringConfigSchema`, `DEFAULT_SCORING`) and emit one plain line per rule, in glossary wording, e.g. "Each qualification win: 2 pts", "Each tie: 1 pt", "Each ranking point: 1 pt", rank tiers ("Ranked 1st–8th after qualification matches: +N pts"), alliance selection ("Alliance captain: …", "First pick: …"), "Each playoff match win: …", "Event winner: …", "Finalist: …", awards, "Top 3 robot ratings (OPR) after qualification matches: +a / +b / +c pts". Use `pt` for exactly 1, `pts` otherwise. Skip zero-valued rules.

- [ ] **Step 5: Implement `PlayerBoard.tsx`** (server). For each score a `Row`: `leading=<RankNumeral rank />`, `title` = name + (isMe ? ' (you)' : ''), `trailing=<Points value={preEvent ? null : total} />` where `preEvent = status === 'setup' || status === 'drafting' || status === 'upcoming'`, `highlight={isMe}`, `defaultOpen={isMe}`, and `expanded`:
  - no teams → `<p className="py-1 text-sm text-fg-muted">No teams yet</p>`;
  - else one line per team (pick order): `<BumperPlate size="sm" number={teamLabel(teamKey)} />`, `teamName(teamKey, teamNames)` (truncate), a muted one-line breakdown `lines.map(lineText).join(' · ')` (truncate), and the team total `<Points size="md" value={preEvent ? null : total} />`;
  - season rounds (`season !== null`): under each team, its events from `season[teamKey]?.events` as indented muted lines via `seasonEventLabel`, and "Next: {name} · {shortDate(startDate)}" from `.next`;
  - player-targeted adjustments (`score.adjustments`) as a final muted line each: `Adjustment: ${lineText(line)}`.
  `isMe = meId !== null && score.playerId === meId`.

- [ ] **Step 6: Implement `EventSwitcher.tsx`** (`'use client'`): chip button `{currentName} ▾` (`min-h-11 max-w-full truncate rounded-full border border-border px-3 text-sm font-semibold`, `aria-haspopup="dialog"`) opening a `Sheet` titled "Events": one `Row href=/l/{slug}/r/{id}` per round (title event name, subtitle `shortDate(startDate)`, `highlight` on the current one), then, when `tbaUrl`, an external link row "View on The Blue Alliance" (`target="_blank" rel="noopener noreferrer"`, sr-only "(opens in a new tab)"). When `rounds.length <= 1 && !tbaUrl` return null.

- [ ] **Step 7: Implement `ScoringSheet.tsx`** (`'use client'`): `Button variant="ghost" size="sm"` "How scoring works" → `Sheet` "How scoring works" with `<ul className="space-y-2">` of `lines`.

- [ ] **Step 8: Implement `EventBody.tsx` and rewrite the round page.**

```tsx
export function EventBody({ slug, view, rounds, meId, playerNames, now }: EventBodyProps) {
  const { round } = view;
  const winner = view.scores.find((s) => s.rank === 1)?.name ?? null;
  const strip = roundStrip({ slug, roundId: round.id, eventName: round.eventName, startDate: round.startDate, endDate: round.endDate,
    status: view.status, kind: round.kind, fetchedAt: view.fetchedAt, stale: view.stale, winnerName: winner }, now);
  const season = round.kind === 'season';
  const preDraft = view.status === 'setup' || view.status === 'drafting';
  const notes = [
    !view.hasEventData && !preDraft
      ? round.kind === 'manual' ? 'No results entered yet.' : season ? 'No events yet this season.' : "The event hasn't started yet."
      : null,
    view.hasEventData && !view.qualsComplete && !season ? `${GLOSSARY.opr.label} bonus is added after qualification matches.` : null,
    view.hasRankings && view.rpMethod === 'none' && !season ? `${GLOSSARY.rp.label} aren't available for this event.` : null,
  ].filter((n): n is string => n !== null);
  return (
    <>
      <StatusStrip tone={strip.tone} title={strip.title} detail={strip.detail}
        action={strip.action ? <Button href={strip.action.href} variant="accent" size="sm">{strip.action.label}</Button> : undefined}
        switcher={<EventSwitcher slug={slug} currentId={round.id} currentName={round.eventName} rounds={rounds}
          tbaUrl={round.eventKey ? tbaEventUrl(round.eventKey) : null} />} />
      {notes.length > 0 ? <ul className="space-y-1 text-sm text-fg-muted">{notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
      <Section label="Leaderboard" action={<ScoringSheet lines={scoringSummary(round.scoring)} />}>
        <PlayerBoard scores={view.scores} meId={meId} teamNames={view.teamNames} status={view.status} season={view.season} />
      </Section>
      {view.adjustments.length > 0 ? (
        <Section label={GLOSSARY.adjust.label}>
          <AdjustmentList adjustments={view.adjustments} playerNames={playerNames} teamNames={view.teamNames} />
        </Section>
      ) : null}
    </>
  );
}
```

(Check the real field name for the round's scoring config on `RoundRow` and `AdjustmentList`'s real props, and adapt.)

The round page:

```tsx
export default async function RoundPage({ params }: Props) {
  const { slug, roundId } = await params;
  const access = await leagueAccess(slug);
  if (!access) notFound();
  if (!access.canView) return <PrivateLeague signedIn={access.user !== null} next={`/l/${slug}/r/${roundId}`} />;
  if (roundId === 'none') return <NoEvents slug={slug} isCommissioner={access.isCommissioner} />;
  const now = new Date();
  const [page, allRounds] = await Promise.all([loadRoundPage(slug, roundId, now), getRepo().listRounds(access.league.id)]);
  if (!page) notFound();
  return (
    <main id="main" className="space-y-6">
      <AutoRefresh seconds={60} />
      <h1 className="sr-only">{page.view.round.eventName}</h1>
      <EventBody slug={slug} view={page.view} now={now} meId={access.player?.id ?? null} playerNames={page.playerNames}
        rounds={allRounds.map((r) => ({ id: r.id, eventName: r.eventName, startDate: r.startDate }))} />
    </main>
  );
}
```

`NoEvents` (same file): `<h1>` "No events yet", "When the commissioner adds an event, it shows up here.", and for commissioners `Button href=/l/{slug}/admin` "Add one in Admin". Keep `export const dynamic` and `maxDuration`. Restyle `AdjustmentList` to `Row`s (title reason, subtitle target, trailing `signed(points)`), logic unchanged.

- [ ] **Step 9: Run** `npx vitest run && npx tsc --noEmit` → green. Update/remove cases in `tests/ui/round-components.test.ts` and `tests/ui/pages.test.ts` that assert the old round page sections (Rosters, Draft board, back link); keep `seasonEventLabel` tests by importing it from the new location.

- [ ] **Step 10: Commit** — `feat(ux): Event tab with status strip and expandable leaderboard`.

### Task 11: Standings — event leagues and full-season leagues

**Files:**
- Create: `components/standings/SeasonBoard.tsx`, `components/standings/EventList.tsx`
- Modify: `app/l/[slug]/page.tsx` (rewrite)
- Modify: `tests/ui/event.test.ts` (append)

**Interfaces:**
- Consumes: `loadLeaguePage` → `LeaguePage` (`standings: SeasonRow[]`, `rounds: RoundView[]`, `anyLive`, `fetchedAt`, `stale`); `EventBody` (Task 10); `targetRound`; `Row`, `Section`, `StatusStrip`, `RankNumeral`, `Points`, `DateBlock`, `StatusBadge`, `ordinal`, `formatDateRange`, `freshnessText`.
- Produces:

```ts
export function SeasonBoard(p: { standings: SeasonRow[]; rounds: { id: string; eventName: string; status: RoundStatus }[]; meId: string | null }): JSX.Element;
export function seasonProgress(rounds: { status: RoundStatus }[]): string;
export function EventList(p: { slug: string; rounds: { id: string; eventName: string; startDate: string; endDate: string; status: RoundStatus; myRank: number | null }[] }): JSX.Element;
```

- [ ] **Step 1: Write the failing tests** (append to `tests/ui/event.test.ts`)

```ts
import { EventList } from '@/components/standings/EventList';
import { SeasonBoard, seasonProgress } from '@/components/standings/SeasonBoard';

describe('seasonProgress', () => {
  it('counts events left', () => {
    expect(seasonProgress([])).toBe('No events yet');
    expect(seasonProgress([{ status: 'final' }, { status: 'live' }, { status: 'upcoming' }])).toBe('3 events · 2 to go');
    expect(seasonProgress([{ status: 'upcoming' }])).toBe('1 event · 1 to go');
    expect(seasonProgress([{ status: 'final' }, { status: 'awaiting_final' }])).toBe('Season over');
  });
});

describe('SeasonBoard', () => {
  const standings = [
    { playerId: 'a', name: 'Mom', total: 400, rank: 1, perRound: [212, 188] },
    { playerId: 'b', name: 'Joey', total: 390, rank: 2, perRound: [198, 192] },
  ];
  const rounds = [{ id: 'r1', eventName: 'Ramp Riot', status: 'final' as const }, { id: 'r2', eventName: 'Brunswick Eruption', status: 'live' as const }];
  it('expands each player to a per-event breakdown by name', () => {
    const html = r(h(SeasonBoard, { standings, rounds, meId: 'b' }));
    expect(html).toContain('Ramp Riot');
    expect(html).toContain('Brunswick Eruption');
    expect(html).toContain('198');
    expect(html).not.toContain('Small numbers are points per round');
    expect(html).toMatch(/<details[^>]*open=""[^>]*>[\s\S]*Joey/);
  });
});

describe('EventList', () => {
  it('links every event and shows your rank there', () => {
    const html = r(h(EventList, { slug: 'fam', rounds: [{ id: 'r1', eventName: 'Ramp Riot', startDate: '2026-10-24', endDate: '2026-10-24', status: 'final', myRank: 2 }] }));
    expect(html).toContain('href="/l/fam/r/r1"');
    expect(html).toContain('You: 2nd');
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** `SeasonBoard`: one `Row` per standing (rank numeral; name + " (you)" when `meId` matches; total `Points`), `expanded` = one line per round in order: event name · `perRound[i]` pts · a small "Final"/"Live" tag for those statuses; `highlight`/`defaultOpen` for `meId`. `seasonProgress`: no rounds → "No events yet"; all rounds `final`/`awaiting_final` → "Season over"; else `"{n} event(s) · {k} to go"` with k = rounds not `final`/`awaiting_final`. `EventList`: `Row href=/l/{encodeURIComponent(slug)}/r/{id}`, `leading=<DateBlock date={startDate} />`, title event name, subtitle `formatDateRange(...)` + (myRank !== null ? ` · You: ${ordinal(myRank)}` : ''), trailing `<StatusBadge status />`.

- [ ] **Step 4: Rewrite `app/l/[slug]/page.tsx`.** Keep the access/private checks and `loadLeaguePage`; `const meId = access.player?.id ?? null`.
  - **`access.league.format === 'event'`:** `AutoRefresh` only when `page.anyLive`; `<StatusStrip tone="neutral" title={seasonProgress(page.rounds)} detail={page.anyLive ? freshnessText(page.fetchedAt, page.stale, now) : undefined} />`; `Section "Standings"` → `SeasonBoard` (or "No players yet — share the invite code from Admin." + commissioner link); `Section "Events"` → `EventList` (`myRank` from each view's `scores` for `meId`) or "No events yet." + commissioner `Button href=/l/{slug}/admin` "Add one in Admin".
  - **`format === 'season'`:** current season round = `targetRound` over `page.rounds`; render `<EventBody … rounds={season rounds} />` (its `EventSwitcher` is the season switcher) and then `Section "Events this season"`: the union of events from `view.season` details (dedupe by `eventKey`, sort by `startDate`) as `Row`s (date block, name, `formatDateRange`). No rounds → the "No events yet" empty state. `AutoRefresh` when that round is live.
  - Remove `LeagueMeCard`, the "Live now" per-round leaderboards and the per-round number footnote.

- [ ] **Step 5: Run** `npx vitest run && npx tsc --noEmit` → green; update `tests/ui/pages.test.ts` standings cases.

- [ ] **Step 6: Commit** — `feat(ux): standings with per-event breakdowns; season leagues show the season`.

### Task 12: Draft tab — draft room and hand-entered board

**Files:**
- Modify: `components/draft/DraftRoom.tsx`, `DraftRoomBanner.tsx`, `PoolList.tsx`, `QueueList.tsx`, `ConfirmSheet.tsx` (copy only), `components/pool/PoolStats.tsx`, `components/pool/TeamSheet.tsx` (labels), `components/DraftBoard.tsx` (restyle), `app/l/[slug]/r/[roundId]/draft/page.tsx`
- Modify: `tests/ui/draft-room.test.ts`, `tests/ui/draft-components.test.ts`, `tests/ui/draft-page.test.ts`, `tests/ui/pool-stats.test.ts`, `tests/ui/team-sheet.test.ts`

**Interfaces:**
- Consumes: `useDraftRoom` (read-only — do not edit), `PageTabs` (Task 3), `InfoTip`/`GLOSSARY` (Task 2), `StatusStrip`, `DraftBoard`, `ordinal`.
- Produces: `DraftRoom` keeps `({ slug, roundId, eventName })`. Tab union becomes `'pool' | 'queue' | 'board'`. New pure exports:

```ts
export function draftTabs(isMember: boolean, queueCount: number): { key: 'pool' | 'queue' | 'board'; label: string }[];
export function defaultDraftTab(phase: 'setup' | 'live' | 'paused' | 'done'): 'pool' | 'board';
```

- [ ] **Step 1: Write the failing tests** (append to `tests/ui/draft-room.test.ts`)

```ts
import { defaultDraftTab, draftTabs } from '@/components/draft/DraftRoom';

describe('draftTabs', () => {
  it('members get Pool · My queue · Board; watchers get Pool · Board; no Rosters tab', () => {
    expect(draftTabs(true, 0).map((t) => t.label)).toEqual(['Pool', 'My queue', 'Board']);
    expect(draftTabs(true, 3).map((t) => t.label)).toEqual(['Pool', 'My queue (3)', 'Board']);
    expect(draftTabs(false, 0).map((t) => t.key)).toEqual(['pool', 'board']);
  });
});
describe('defaultDraftTab', () => {
  it('opens the board once the draft is done', () => {
    expect(defaultDraftTab('done')).toBe('board');
    expect(defaultDraftTab('setup')).toBe('pool');
    expect(defaultDraftTab('live')).toBe('pool');
    expect(defaultDraftTab('paused')).toBe('pool');
  });
});
```

Banner tests (adapt the existing `DraftRoomBanner` cases in `tests/ui/draft-components.test.ts`; read its current props first, keep them, and add only `myPosition: number | null` and `playerCount: number`): setup → "Draft hasn't started" and, when `myPosition` is 2 of 6, "You pick 2nd of 6"; live + my turn → "Your pick!"; paused → "Paused by the commissioner"; done → "Draft complete". `ConfirmSheet`'s `confirmText` → `Draft 341 · Projected 38.2?` (update its test).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Restructure `DraftRoom.tsx`** (hook calls and handlers untouched):
  - Tabs from `draftTabs(me !== null, queueCount)` (queueCount = untaken queue length, as today); initial tab `defaultDraftTab(state.phase)` the first time state loads (don't switch tabs on the user later).
  - Remove the Rosters tab and the `DraftRosters` import.
  - Replace the hand-rolled tab buttons with `<PageTabs label="Draft room" … />`.
  - Remove the "‹ {event}" back link and visible heading; keep `<h1 className="sr-only">{eventName} draft</h1>`.
  - Replace the collapsed "Draft options" `<details>` with: an **auto-draft switch** row (members only) right under the banner — `GLOSSARY.autodraft.label` + `<InfoTip term="autodraft" />` + a `role="switch" aria-checked` button (44px) wired to the existing toggle handler and `autodraftShown` logic — and a **commissioner strip** (commissioners only) `aria-label="Commissioner controls"` with the existing Pause / Resume / Undo last pick buttons (`size="sm"`, same handlers and disabled rules).
  - Watchers: muted line "You're watching — only league members can draft."
- [ ] **Step 4: `DraftRoomBanner.tsx`** — sticky (`sticky top-14 z-20`), full-bleed band strip (`-mx-4 bg-band px-4 py-3 text-on-band`): setup "Draft hasn't started" + "You pick {ordinal(myPosition)} of {playerCount}" + `GLOSSARY.snake.label` + `<InfoTip term="snake" />`; live "On the clock: {name} · 0:42" (existing timer) plus "Your pick!" (24px, `text-accent`) or "You're up in {n} picks"; paused "Paused by the commissioner"; done "Draft complete". Keep the countdown and aria-live behavior. Compute `myPosition` (1-based index of `state.me.playerId` in the draft order, or null) and `playerCount` in `DraftRoom` from `state` — check `DraftState` (`lib/draft/state.ts`) for where draft order lives.
- [ ] **Step 5: Pool labels.** `PoolList.tsx`, `PoolStats.tsx`, `TeamSheet.tsx`: display labels "Proj" → `GLOSSARY.proj.label`, "OPR" → `GLOSSARY.opr.label` (numbers/formatting unchanged); sort options "Projected", "Robot rating", "Team number" (values unchanged); `InfoTip term="proj"` beside the sort control. Pool rows in the `Row` style (hairline, no card): plate, team name, "Projected 52 · Robot rating 38", queue toggle, Draft button `size="sm"`.
- [ ] **Step 6: Hand-entered rounds.** In `app/l/[slug]/r/[roundId]/draft/page.tsx`, replace the "No live draft for this round" branch with:

```tsx
<main id="main" className="space-y-4">
  <h1 className="sr-only">{round.eventName} draft</h1>
  <StatusStrip tone={done ? 'final' : 'neutral'} title={done ? 'Draft complete' : 'The commissioner enters picks for this event'} detail={`${picks.length} of ${total} picks`} />
  <DraftBoard picks={picks} draftOrder={round.draftOrder} rosterSize={round.rosterSize} playerNames={playerNames} teamNames={teamNames} />
</main>
```

Use `loadRoundPage(slug, roundId, now)` for `round`, `picks`, `playerNames`, `teamNames` if the page doesn't already have them; `total = round.draftOrder.length * round.rosterSize`; `done = total > 0 && picks.length >= total`. Restyle `DraftBoard`: blue plates, no card wrapper, wrapped in `overflow-x-auto` (the board may be wider than 360px — the one allowed sideways scroll, inside its own container).
- [ ] **Step 7: Run** `npx vitest run && npx tsc --noEmit` → green.
- [ ] **Step 8: Commit** — `feat(ux): draft room with visible auto-draft, commissioner strip and plain labels`.

### Task 13: Join, Sign in, Create a league, Landing

**Files:**
- Modify: `components/JoinView.tsx`, `app/join/[code]/page.tsx`, `components/SignInForm.tsx`, `app/signin/page.tsx`, `components/CreateLeagueForm.tsx`, `components/landing/Landing.tsx`, `components/landing/SampleScoreboard.tsx`
- Modify/Create: `tests/ui/join.test.ts`, `tests/ui/landing.test.ts`, `tests/ui/signInForm.test.ts`, `tests/ui/signin-page.test.ts`

**Interfaces:**
- Consumes: `shortDate`, `Row`, `RankNumeral`, `Points`, `Section`, `Button`, `BumperPlate`.
- Produces: `export function joinDescription(league: { format: LeagueFormat; seasonYear?: number | null }, next: { eventName: string; startDate: string } | null): string` in `JoinView.tsx`.

- [ ] **Step 1: Write the failing tests.** `tests/ui/join.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { joinDescription } from '@/components/JoinView';

describe('joinDescription', () => {
  it('describes the league in plain words', () => {
    expect(joinDescription({ format: 'event' }, { eventName: 'Ramp Riot', startDate: '2026-10-24' })).toBe('Event by event · next up Ramp Riot, Oct 24');
    expect(joinDescription({ format: 'event' }, null)).toBe('Event by event · no events yet');
    expect(joinDescription({ format: 'season', seasonYear: 2026 }, null)).toBe('Full 2026 season');
    expect(joinDescription({ format: 'season', seasonYear: null }, null)).toBe('Full season');
  });
});
```

`tests/ui/signInForm.test.ts`: the rendered form contains `Forgot your password? Ask the league commissioner to reset it.` and not `site admin`. `tests/ui/landing.test.ts`: the signed-out landing contains `href="/signin?mode=signup"` and `href="/signin"` with text "Sign in".

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Join.** `app/join/[code]/page.tsx`: also load (database only) the league's rounds; `next` = the first round (by `startDate`) with `startDate >= today`, else null; for season leagues `seasonYear` from the latest season round (`round.seasonYear`). Pass `description` and player count to `JoinView`, which renders a card: "You're invited to **{league}**", `description`, "Run by {commissioner} · {n} players", then Join / inline sign-up (logic unchanged).
- [ ] **Step 4: Sign in.** Restyle `SignInForm`; replace the forgot-password sentence with the exact copy.
- [ ] **Step 5: Create a league.** Helper text per spec §6.10 exactly: visibility "Anyone with the link can watch" / "Only members can see it"; Event by event "Draft new teams for each event."; Follow teams "Follow up to 3 teams and we'll add each event they attend automatically."; Full season "Draft once and score every official event all year." The format choice becomes two large native-radio option rows (label wraps the input, ≥44px, selected = `border-fg`). Field names, validation, API call unchanged.
- [ ] **Step 6: Landing.** Restyle to the new system (band-colored hero, rows instead of cards for "How it works" and "Coming up"); same content and order; add `Button href="/signin" variant="secondary"` "Sign in" beside "Create an account". `SampleScoreboard` uses `Row` + `RankNumeral` + `Points` with blue plates.
- [ ] **Step 7: Run** `npx vitest run && npx tsc --noEmit` → green.
- [ ] **Step 8: Commit** — `feat(ux): join, sign-in, create-league and landing in the new style`.

---

## Phase 4 — Admin

### Task 14: Admin step logic + event-code parsing

**Files:**
- Create: `lib/admin/steps.ts`, `lib/admin/eventInput.ts`, `tests/admin/steps.test.ts`, `tests/admin/eventInput.test.ts`

**Interfaces:**
- Consumes: `RoundStatus`.
- Produces:

```ts
// lib/admin/steps.ts
export type AdminStep = 1 | 2 | 3 | 4;
export function setupDone(round: { draftOrder: string[]; rosterSize: number }, playerIds: string[]): boolean;
export function adminStep(status: RoundStatus, setupComplete: boolean): AdminStep;
export function stepDone(step: AdminStep, current: AdminStep): boolean;
export const STEP_TITLE: Record<AdminStep, string>; // 1 'Set up', 2 'Run the draft', 3 'During the event', 4 'Wrap up'

// lib/admin/eventInput.ts
export function parseEventInput(raw: string): string;
```

- [ ] **Step 1: Write the failing tests** — `tests/admin/steps.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { adminStep, setupDone, stepDone, STEP_TITLE } from '@/lib/admin/steps';

describe('setupDone', () => {
  it('needs a roster size and every current player in the draft order', () => {
    expect(setupDone({ draftOrder: ['a', 'b'], rosterSize: 3 }, ['a', 'b'])).toBe(true);
    expect(setupDone({ draftOrder: ['b', 'a', 'x'], rosterSize: 3 }, ['a', 'b'])).toBe(true);
    expect(setupDone({ draftOrder: ['a'], rosterSize: 3 }, ['a', 'b'])).toBe(false);
    expect(setupDone({ draftOrder: [], rosterSize: 3 }, [])).toBe(false);
    expect(setupDone({ draftOrder: ['a', 'b'], rosterSize: 0 }, ['a', 'b'])).toBe(false);
  });
});

describe('adminStep', () => {
  it('maps round status to the open step', () => {
    expect(adminStep('setup', false)).toBe(1);
    expect(adminStep('setup', true)).toBe(2);
    expect(adminStep('drafting', false)).toBe(2);
    expect(adminStep('drafting', true)).toBe(2);
    expect(adminStep('upcoming', true)).toBe(3);
    expect(adminStep('live', true)).toBe(3);
    expect(adminStep('awaiting_final', true)).toBe(4);
    expect(adminStep('final', true)).toBe(4);
  });
});

describe('stepDone', () => {
  it('earlier steps are done', () => {
    expect(stepDone(1, 2)).toBe(true);
    expect(stepDone(2, 2)).toBe(false);
    expect(stepDone(4, 3)).toBe(false);
  });
  it('has a title for each step', () => {
    expect(STEP_TITLE).toEqual({ 1: 'Set up', 2: 'Run the draft', 3: 'During the event', 4: 'Wrap up' });
  });
});
```

`tests/admin/eventInput.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseEventInput } from '@/lib/admin/eventInput';

describe('parseEventInput', () => {
  it('accepts a bare code in any case with spaces', () => {
    expect(parseEventInput('2025parr')).toBe('2025parr');
    expect(parseEventInput('  2025PARR ')).toBe('2025parr');
  });
  it('pulls the code out of a TBA link', () => {
    expect(parseEventInput('https://www.thebluealliance.com/event/2025parr')).toBe('2025parr');
    expect(parseEventInput('thebluealliance.com/event/2025parr#rankings')).toBe('2025parr');
    expect(parseEventInput('https://www.thebluealliance.com/event/2025parr/')).toBe('2025parr');
    expect(parseEventInput('https://www.thebluealliance.com/event/2025PARR?tab=teams')).toBe('2025parr');
  });
  it('leaves anything else trimmed and lowercased for the validator to reject', () => {
    expect(parseEventInput(' Not A Code ')).toBe('not a code');
    expect(parseEventInput('https://example.com/x')).toBe('https://example.com/x');
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
// lib/admin/steps.ts
import type { RoundStatus } from '@/lib/rounds/status';

export type AdminStep = 1 | 2 | 3 | 4;

export const STEP_TITLE: Record<AdminStep, string> = { 1: 'Set up', 2: 'Run the draft', 3: 'During the event', 4: 'Wrap up' };

/** Setup is done when there is a roster size and every current player has a draft slot (spec §8.2). */
export function setupDone(round: { draftOrder: string[]; rosterSize: number }, playerIds: string[]): boolean {
  if (round.rosterSize <= 0 || round.draftOrder.length === 0) return false;
  const order = new Set(round.draftOrder);
  return playerIds.every((id) => order.has(id));
}

/** Which checklist step round admin opens on (spec §7.2). */
export function adminStep(status: RoundStatus, setupComplete: boolean): AdminStep {
  switch (status) {
    case 'setup':
      return setupComplete ? 2 : 1;
    case 'drafting':
      return 2;
    case 'upcoming':
    case 'live':
      return 3;
    case 'awaiting_final':
    case 'final':
      return 4;
  }
}

export function stepDone(step: AdminStep, current: AdminStep): boolean {
  return step < current;
}
```

```ts
// lib/admin/eventInput.ts
/** "2025parr", " 2025PARR ", or a TBA event link → "2025parr". Anything else comes back trimmed and lowercased. */
export function parseEventInput(raw: string): string {
  const s = raw.trim();
  const m = /thebluealliance\.com\/event\/([a-z0-9]+)/i.exec(s);
  return (m ? m[1] : s).toLowerCase();
}
```

- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit` → green.
- [ ] **Step 5: Commit** — `feat(ux): admin checklist step rules and TBA link parsing`.

### Task 15: League admin page

**Files:**
- Create: `components/admin/InviteCard.tsx`, `components/admin/EventPicker.tsx`, `tests/ui/admin-v3.test.ts`
- Modify: `components/admin/AdminDashboard.tsx`, `components/admin/DashboardParts.tsx`, `components/admin/MembersCard.tsx`, `components/admin/FollowTeamsForm.tsx` (helper text), `components/admin/ScoringForm.tsx` (restyle), `components/admin/DangerZone.tsx` (restyle), `app/l/[slug]/admin/page.tsx`
- Modify: `tests/ui/admin-components.test.ts`

**Interfaces:**
- Consumes: `parseEventInput` (Task 14); `loadUpcomingEvents(now)` from `lib/views/landing.ts` (returns `TbaEvent[]`, already cached via `tba_cache`) — call it in the server page and pass a trimmed list down; `Row`, `Section`, `Sheet`, `Button`; existing admin client calls in `lib/admin/client.ts` and `useAdmin`/`usePending`.
- Produces:

```ts
export function InviteCard(p: { leagueName: string; code: string; onReset: () => void; busy: boolean }): JSX.Element; // client
export function shareOrCopy(url: string, title: string, nav: { share?: (d: ShareData) => Promise<void>; clipboard?: { writeText: (t: string) => Promise<void> } } | undefined): Promise<'shared' | 'copied' | 'failed'>;
export function EventPicker(p: { upcoming: { key: string; name: string; startDate: string; endDate: string }[]; onPick: (eventKey: string) => void; busy: boolean }): JSX.Element; // client
```

- [ ] **Step 1: Write the failing tests** — `tests/ui/admin-v3.test.ts`

```ts
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InviteCard, shareOrCopy } from '@/components/admin/InviteCard';
import { EventPicker } from '@/components/admin/EventPicker';

const r = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('shareOrCopy', () => {
  it('uses the share sheet when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareOrCopy('https://x/join/AB', 'Join', { share })).toBe('shared');
    expect(share).toHaveBeenCalledWith({ url: 'https://x/join/AB', title: 'Join' });
  });
  it('falls back to copying', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareOrCopy('u', 't', { clipboard: { writeText } })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('u');
  });
  it('copies when sharing is cancelled, and reports failure with neither', async () => {
    const share = vi.fn().mockRejectedValue(new Error('AbortError'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareOrCopy('u', 't', { share, clipboard: { writeText } })).toBe('copied');
    expect(await shareOrCopy('u', 't', undefined)).toBe('failed');
  });
});

describe('InviteCard', () => {
  it('shows the code big with Share link and Reset code', () => {
    const html = r(h(InviteCard, { leagueName: 'Family', code: 'K7Q2XP', onReset: () => {}, busy: false }));
    expect(html).toContain('K7Q2XP');
    expect(html).toContain('Share link');
    expect(html).toContain('Reset code');
    expect(html).toContain('font-display');
  });
});

describe('EventPicker', () => {
  it('lists upcoming events and an Other event field that accepts TBA links', () => {
    const html = r(h(EventPicker, { upcoming: [{ key: '2026parr', name: 'Ramp Riot', startDate: '2026-10-24', endDate: '2026-10-24' }], onPick: () => {}, busy: false }));
    expect(html).toContain('Ramp Riot');
    expect(html).toContain('Oct 24');
    expect(html).toContain('TBA link or event code');
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `InviteCard.tsx`** (`'use client'`):

```ts
type ShareNav = { share?: (d: ShareData) => Promise<void>; clipboard?: { writeText: (t: string) => Promise<void> } };

export async function shareOrCopy(url: string, title: string, nav: ShareNav | undefined): Promise<'shared' | 'copied' | 'failed'> {
  if (nav?.share) {
    try {
      await nav.share({ url, title });
      return 'shared';
    } catch {
      // cancelled or blocked: try copying instead
    }
  }
  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(url);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  return 'failed';
}
```

Markup: `Section label="Invite people"` → the code in `font-display text-[40px] font-bold tracking-[.12em]`, a muted line "Share this link, or tell people the code.", `Button variant="primary"` "Share link" (calls `shareOrCopy(`${location.origin}/join/${code}`, `Join ${leagueName}`, navigator)`, shows "Link copied" after `copied`, "Couldn't share — copy the code instead" after `failed`), and `Button variant="ghost" size="sm"` "Reset code" → `onReset` (the dashboard passes the existing reset handler + confirm, moved out of `MembersCard`).

- [ ] **Step 4: Implement `EventPicker.tsx`** (`'use client'`): `Section label="Add an event"`: up to 6 upcoming events as `Row`s (title name, subtitle `formatDateRange`, trailing "Add" `Button size="sm"` → `onPick(key)`), then a form "Other event": `Input label="TBA link or event code (like 2025parr)"` whose submit calls `onPick(parseEventInput(value))`. The dashboard's existing add-round flow (check → "Found" preview → add) receives the key exactly as the old `AddRoundForm` input did — extract that submit logic into a function both call; keep `AddRoundForm`'s existing tests passing (or port them).

- [ ] **Step 5: Reorganize `AdminDashboard.tsx`** in this order (spec §7.1): `InviteCard` → **Events** (`Section "Events"`: one `Row` per round — `leading=<DateBlock>`, title name, subtitle "{picks} of {total} picks" / "Draft not set up", trailing `StatusBadge`, `href=/l/{slug}/admin/r/{id}`; **no Delete button on these rows**) + `EventPicker` + a collapsed `<details>` "More ways to add events" holding `AddManualRoundForm` and `FollowTeamsForm` (helper text "Follow up to 3 teams and we'll add each event they attend automatically."); for `format === 'season'` this section is **Season** with the existing season row(s) and "Start {year} season" logic → **Members** (`MembersCard` restyled: a `Row` per member with a ⋯ button opening a `Sheet` with Make commissioner / Make player / Remove — existing calls and confirms) → **Settings** (`Section "Settings"`: `RenameLeague`, the visibility control moved out of `MembersCard`, `ScoringForm` collapsed in `<details>` "Default scoring") → `DangerZone`. Drop the "View league page" / "Copy … link" header row. In `app/l/[slug]/admin/page.tsx` pass `upcoming` = `(await loadUpcomingEvents(now).catch(() => []))` mapped to `{ key, name, startDate, endDate }` (check `TbaEvent` field names in `lib/tba/types.ts`).
- [ ] **Step 6: Update `tests/ui/admin-components.test.ts`** for moved pieces (invite code now in `InviteCard`, visibility under Settings) and add an assertion that dashboard round rows contain no "Delete".
- [ ] **Step 7: Run** `npx vitest run && npx tsc --noEmit` → green.
- [ ] **Step 8: Commit** — `feat(ux): league admin opens with Invite people; events picker; settings grouped`.

### Task 16: Round admin checklist

**Files:**
- Create: `components/admin/RoundChecklist.tsx`
- Modify: `components/admin/RoundAdmin.tsx`, `components/admin/RoundSetup.tsx` (drop its `<details>` wrapper), `components/admin/LiveDraftControls.tsx` (the mode select moves to a "Switch to …" link), `components/admin/DraftEntry.tsx` (title its replace-a-pick UI "Fix a pick"), `app/l/[slug]/admin/r/[roundId]/page.tsx`
- Modify: `tests/ui/admin-components.test.ts`, `tests/ui/admin-v3.test.ts` (append)

**Interfaces:**
- Consumes: `adminStep`, `setupDone`, `STEP_TITLE`, `AdminStep` (Task 14); `SectionProps` from `RoundAdmin.tsx`; the existing PATCH `/rounds/{id}` with `{ draftMode }` (same call `LiveDraftControls` makes today).
- Produces:

```ts
export type ChecklistStep = { step: AdminStep; summary: string; preview: string; content: ReactNode };
export function RoundChecklistView(p: { current: AdminStep; open: AdminStep[]; steps: ChecklistStep[]; onToggle: (s: AdminStep) => void }): JSX.Element;
export function RoundChecklist(p: { current: AdminStep; steps: ChecklistStep[] }): JSX.Element; // client; initial open = [current]
export function stepSummaries(input: {
  playerCount: number; rosterSize: number; picks: number; kind: RoundKind; manualResults: number; finalized: boolean;
}): Record<AdminStep, { summary: string; preview: string }>;
```

- [ ] **Step 1: Write the failing tests** (append to `tests/ui/admin-v3.test.ts`)

```ts
import { RoundChecklistView, stepSummaries } from '@/components/admin/RoundChecklist';

describe('stepSummaries', () => {
  it('one-line summaries for done steps and previews for future ones', () => {
    const s = stepSummaries({ playerCount: 6, rosterSize: 4, picks: 24, kind: 'tba', manualResults: 0, finalized: false });
    expect(s[1].summary).toBe('6 players · 4 teams each');
    expect(s[2].summary).toBe('Draft complete · 24 picks');
    expect(s[3].preview).toBe('Scores update from The Blue Alliance automatically. Fix anything with adjustments.');
    expect(s[4].summary).toBe('Not final yet');
    const manual = stepSummaries({ playerCount: 2, rosterSize: 3, picks: 6, kind: 'manual', manualResults: 5, finalized: true });
    expect(manual[3].summary).toBe('5 results entered');
    expect(manual[4].summary).toBe('Final');
  });
});

describe('RoundChecklistView', () => {
  const steps = ([1, 2, 3, 4] as const).map((step) => ({ step, summary: `sum${step}`, preview: `pre${step}`, content: `content${step}` }));
  it('numbers the steps, checks done ones, opens only the current step', () => {
    const html = r(h(RoundChecklistView, { current: 2, open: [2], steps, onToggle: () => {} }));
    for (const t of ['Set up', 'Run the draft', 'During the event', 'Wrap up']) expect(html).toContain(t);
    expect(html).toContain('sum1');
    expect(html).toContain('content2');
    expect(html).not.toContain('content3');
    expect(html).toContain('pre3');
    expect(html).toMatch(/aria-current="step"/);
    expect(html.match(/aria-expanded="true"/g)?.length).toBe(1);
  });
  it('any step can be opened', () => {
    expect(r(h(RoundChecklistView, { current: 2, open: [2, 4], steps, onToggle: () => {} }))).toContain('content4');
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `RoundChecklist.tsx`** (`'use client'`). `stepSummaries`: step 1 summary `"{playerCount} players · {rosterSize} teams each"`, preview "Roster size, draft order and the team pool"; step 2 summary `"Draft complete · {picks} picks"`, preview "Live draft on everyone's phones, or enter picks yourself"; step 3 summary `kind === 'manual' ? "{manualResults} results entered" : 'Scores came from The Blue Alliance'`, preview `kind === 'manual' ? 'Enter results as the event happens. Fix anything with adjustments.' : 'Scores update from The Blue Alliance automatically. Fix anything with adjustments.'`; step 4 summary `finalized ? 'Final' : 'Not final yet'`, preview "Mark the round final when the event ends". `RoundChecklistView`: an `<ol>`; each step an `<li>` with a header `<button type="button" aria-expanded aria-controls>` (min-h-11) holding the step circle (done: ✓ on `bg-success text-on-success`; current: number in a gold ring `border-2 border-accent`; future: number in a muted ring) + `STEP_TITLE[step]` + a muted one-liner (done → summary + " · Edit"; future → preview; current → nothing); the current `<li>` gets `aria-current="step"` and the gold inset bar `shadow-[inset_4px_0_0_var(--color-accent)] bg-surface`; open steps render `content` below in a region with the matching id. `RoundChecklist` holds `open` state (initially `[current]`), toggling on header click.
- [ ] **Step 4: Rebuild `RoundAdmin.tsx`** as: header ("‹ Admin" link to `/l/{slug}/admin`, event name, dates, `StatusBadge`, key line) → sticky error/notice (unchanged) → `RoundChecklist` with:
  - step 1 content: `RoundSetup` (without its `<details>` wrapper);
  - step 2 content: `round.draftMode === 'live'` → `LiveDraftControls` (timer + Start/Pause/Resume + "Open draft room"), else → `DraftEntry`; plus `Button variant="ghost" size="sm"` "Switch to {entering picks by hand | a live draft}" calling the same PATCH `{ draftMode }` the old select used, disabled under the same rule (`started || picks.length > 0`) with the hint "You can't switch once the draft has started."; once the draft is complete, `DraftEntry`'s replace-a-pick UI titled "Fix a pick";
  - step 3 content: "Refresh from TBA" (non-manual), `ManualResultsEditor` (manual), `AdjustmentEditor`;
  - step 4 content: the existing finalize nudge copy + Mark round final / Reopen round.
  Below the checklist, a muted "Delete this event" `Button variant="danger" size="sm"` with the existing delete call and confirm (moved from the dashboard), returning to `/l/{slug}/admin` on success. `current = adminStep(status, setupDone(round, playerIds))` — compute from whatever `detail` carries (check `RoundAdmin`'s `detail` type for status, players and manual results count).
- [ ] **Step 5: Update `tests/ui/admin-components.test.ts`** for the restructure (the mode select no longer lives in `LiveDraftControls`; `RoundSetup` has no `<details>`).
- [ ] **Step 6: Run** `npx vitest run && npx tsc --noEmit` → green.
- [ ] **Step 7: Commit** — `feat(ux): round admin as a four-step checklist`.

---

## Phase 5 — Polish and verify

### Task 17: Remove replaced UI and update docs

**Files:**
- Remove (each only after `grep -rn "<Name>" app components lib tests` shows no importers other than its own tests): `components/AppTabBar.tsx`, `components/TabBar.tsx`, `components/LeagueBar.tsx`, `components/HeaderAccount.tsx`, `components/ThemeToggle.tsx`, `components/LeagueMeCard.tsx`, `components/Leaderboard.tsx`, `components/RosterList.tsx`, `components/me/MeHome.tsx`, `components/draft/LiveDraftBanner.tsx`, `components/draft/DraftRosters.tsx`, `lib/views/me.ts` (move its `seasonSummary` test cases to `tests/views/home.test.ts`; drop `matchLabel`/`nextMatchLabel`/`loadMePage` cases with the code)
- Modify: `lib/nav.ts` (drop the deprecated `activeTab`/`showAppTabBar`), tests that only covered removed components, `CLAUDE.md`, `README.md`

- [ ] **Step 1:** For each file above, grep for importers; remove the file and its orphaned test cases with `git rm`; tests covering behavior that moved should already import from the new location.
- [ ] **Step 2:** Drop the deprecated compatibility exports from `lib/nav.ts`.
- [ ] **Step 3:** `CLAUDE.md` "Current status": add "UX overhaul (branch `ux-overhaul`, 2026-10-01): Home/Leagues/You bottom bar, league top tabs (Standings · Event · Draft · Admin), broadcast-scoreboard style; spec `docs/superpowers/specs/2026-10-01-ux-overhaul-design.md`." and make "Tabled" list only auto-finalize. `README.md`: update anything mentioning the Me tab, `/me/settings` or the old Round tab.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit && npx next build` → green (the build catches server/client boundary mistakes tests miss).
- [ ] **Step 5: Commit** — `chore(ux): remove replaced components; docs`.

### Task 18: E2E — live draft update, navigation spec, screenshots script

**Files:**
- Modify: `e2e/live-draft.spec.ts`, `e2e/helpers.ts` (if selectors live there)
- Create: `e2e/navigation.spec.ts`, `scripts/screens.ts`

**Interfaces:**
- Consumes: local dev server + the real dev Supabase project (as v2's E2E did), `POST /api/test/login` with `Authorization: Bearer $E2E_AUTH_SECRET`, `scripts/seed-demo.ts`.

- [ ] **Step 1:** Read `e2e/live-draft.spec.ts`, `e2e/helpers.ts` and `playwright.config.*`. Update selectors: draft tabs are `role="tab"` "Pool", "My queue", "Board" (no "Rosters"); auto-draft is `role="switch"` named "Auto-draft"; Pause/Resume/Undo are inside `aria-label="Commissioner controls"` (no "Draft options" disclosure); "Start draft" lives in round admin step 2 "Run the draft" (open by default once setup is complete); confirm text "Draft {n} · Projected …?".
- [ ] **Step 2:** Create `e2e/navigation.spec.ts`: sign in via the test login route; create a league with one round using the same helpers/APIs the live-draft spec uses; visit `/` → expect `nav[aria-label="App"]` and the "Your leagues" section; click the league row → expect `nav[aria-label="League"]` with Standings `aria-current="page"`; click "Event" → URL `/l/{slug}/r/{id}`, `role="status"` strip visible; click "Draft" → URL ends `/draft`; click "Standings"; click "Home" in the bottom bar → `/`. Assert the bottom bar is visible at every step. Start the live draft via the API and assert the pill ("Draft is live") appears on `/` and links to the draft room. Clean up the league the way the live-draft spec does.
- [ ] **Step 3:** Create `scripts/screens.ts` (`npx tsx scripts/screens.ts`): Playwright Chromium at 390×844, logs in via the test route, and for `/`, `/leagues`, `/you`, `/leagues/new`, the demo league's `/l/{slug}`, `/l/{slug}/r/{id}`, `/l/{slug}/r/{id}/draft`, `/l/{slug}/admin`, `/l/{slug}/admin/r/{id}`, plus signed-out `/signin` and `/`, saves light and dark full-page PNGs (set `localStorage['frcf:theme']` via `addInitScript`) to `.superpowers/sdd/2026-10-01-ux-overhaul/screens/{name}-{theme}.png`. Also 360px-wide shots of the Event and round-admin pages. The script exits non-zero if `document.documentElement.scrollWidth > window.innerWidth` on any page (no sideways scroll).
- [ ] **Step 4: Run** `npm run e2e` (with the dev server per the config) and `npx tsx scripts/screens.ts`; fix failures. If the dev Supabase project is paused/unreachable, record it in the ledger and `final-review-notes.md` and continue — never fake a pass.
- [ ] **Step 5: Commit** — `test(ux): navigation E2E, updated live-draft E2E, screenshot script`.

### Task 19: Accessibility and visual pass (controller-run)

**Files:** whatever the findings touch.

- [ ] **Step 1:** Run the `web-design-guidelines` skill over the changed UI (`components/**`, `app/**/page.tsx`, `app/layout.tsx`).
- [ ] **Step 2:** Review every Task 18 screenshot in both themes: no card-in-card; plates blue; gold only on leader / current step / active tab / pill; long names truncate; bottom bar and pill never cover the last row; focus rings visible.
- [ ] **Step 3:** Fix findings; re-run `npx vitest run && npx tsc --noEmit && npx next build` and the screenshots.
- [ ] **Step 4: Commit** — `fix(ux): accessibility and visual polish`.

---

## After the tasks

1. One comprehensive whole-branch review on the most capable model (Joey's standing preference) with `final-review-notes.md` as input; one fix wave.
2. Push `ux-overhaul` and open a PR (Vercel preview). **Do not merge** — Joey checks it on his phone first.
