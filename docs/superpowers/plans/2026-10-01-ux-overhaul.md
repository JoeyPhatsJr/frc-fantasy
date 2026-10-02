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

- [ ] **Step 6: Rewire `app/l/[slug]/layout.tsx`.** Extend `loadShell` (database only — no TBA) to also return `format: league.format`, `isMember` (`access.member !== null` — check `LeagueAccess` in `lib/auth/roles.ts` for the member field name), `myName` (the member's display name in this league from `repo.listPlayers` / `withPublicNames`, or null), and `myLeagues` (if signed in: `repo.listLeaguesForUser(user.id)` minus this league, mapped to `{ slug, name }`; wrap in try/catch → `[]` on failure, Review Focus 5). Replace `<LeagueBar/>` + `<TabBar/>` with `<LeagueHeader {...} />`. Keep the existing error fallback (`return children`) and `canView` behavior.

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

- [ ] **Step 1: Write the failing tests** — `tests/views/liveDrafts.test.ts`. Use the in-memory repo the other view tests use (`tests/helpers/memoryRepo.ts` + `tests/helpers/builders.ts`; read `tests/views/views.test.ts` for how a repo is installed — mirror it exactly). Cases:
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
