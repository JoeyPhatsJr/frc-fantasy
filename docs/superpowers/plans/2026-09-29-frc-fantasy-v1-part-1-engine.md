# FRC Fantasy v1 — Part 1: Scaffold + Scoring Engine (Tasks 1–11)

> Part of `2026-09-29-frc-fantasy-v1.md`. Read that file first: its **Global Constraints**, **Deviations**, and **Review Focus** apply to every task here.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Spec:** `docs/superpowers/specs/2026-09-29-frc-fantasy-design.md`

Every commit message ends with a blank line and then:
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`

---

### Task 1: Scaffold the project

We scaffold by hand instead of `create-next-app` because the folder name "FRC Fantasy" (space + capitals) is not a legal npm package name and the generator refuses it.

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.env.example`
- Create: `app/layout.tsx`, `app/globals.css`, `app/page.tsx`
- Create: `tests/smoke.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` (Vitest, runs once), `npm run typecheck`, `npm run build`, `npm run dev`. Import alias `@/` = repo root, working in both Next.js and Vitest.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "frc-fantasy",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm install next@16 react@19 react-dom@19 zod@4 @supabase/supabase-js@2
npm install -D typescript @types/node @types/react @types/react-dom tailwindcss@4 @tailwindcss/postcss vitest@5 tsx
```

Expected: both finish with no `ERR!` lines. `package.json` now has `dependencies` and `devDependencies`.

- [ ] **Step 3: Write the config files**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.ts` (deliberately empty: Cache Components must stay off, spec §9.2):

```ts
import type { NextConfig } from 'next';

// Cache Components is intentionally NOT enabled (spec §9.2).
// tba_cache in Postgres is the only cache layer.
const nextConfig: NextConfig = {};

export default nextConfig;
```

`postcss.config.mjs`:

```js
export default {
  plugins: { '@tailwindcss/postcss': {} },
};
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

`.env.example`:

```
# Copy to .env.local and fill in. Never commit .env.local.
TBA_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CREATE_LEAGUE_PASSCODE=
```

Append to `.gitignore` (keep the two existing lines):

```
node_modules/
.next/
.vercel/
.env*.local
next-env.d.ts
*.tsbuildinfo
```

- [ ] **Step 4: Write the app shell**

`app/globals.css`:

```css
@import "tailwindcss";

body {
  @apply bg-white text-slate-900 antialiased;
}
```

`app/layout.tsx`:

```tsx
import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FRC Fantasy',
  description: 'Fantasy drafts for FIRST Robotics Competition events.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto w-full max-w-xl px-4 py-6">{children}</div>
      </body>
    </html>
  );
}
```

`app/page.tsx` (replaced in Task 25):

```tsx
export default function HomePage() {
  return (
    <main>
      <h1 className="text-2xl font-bold">FRC Fantasy</h1>
      <p className="mt-2 text-slate-600">Draft FRC teams. Score points from real results.</p>
    </main>
  );
}
```

- [ ] **Step 5: Write the smoke test**

`tests/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import pkg from '@/package.json';

describe('project setup', () => {
  it('resolves the @/ alias to the repo root', () => {
    expect(pkg.name).toBe('frc-fantasy');
  });
});
```

- [ ] **Step 6: Run everything**

```bash
npm test && npm run typecheck && npm run build
```

Expected: 1 test passes; `tsc` prints nothing; `next build` ends with a route table listing `/`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 16, Tailwind 4, Vitest 5"
```

---

### Task 2: Scoring config schema and defaults

**Files:**
- Create: `lib/scoring/config.ts`
- Test: `tests/scoring/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `scoringConfigSchema` (zod schema)
  - `type ScoringConfig` with fields `version: 1`, `qualWin`, `qualTie`, `qualLoss`, `rankingPoint`, `rankTiers: { maxRank: number; points: number }[]`, `alliance: { captain, pick1, pick2, pick3, backup }`, `playoffMatchWin`, `eventWinner`, `eventFinalist`, `awards: { byType: Record<string, number>; excludedTypes: number[]; default: number }`, `oprBonus: number[]`
  - `DEFAULT_SCORING: ScoringConfig`
  - `defaultScoring(): ScoringConfig` (a fresh deep copy, safe to mutate)

- [ ] **Step 1: Write the failing test**

`tests/scoring/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING, defaultScoring, scoringConfigSchema } from '@/lib/scoring/config';

describe('scoringConfigSchema', () => {
  it('accepts the defaults', () => {
    expect(scoringConfigSchema.safeParse(DEFAULT_SCORING).success).toBe(true);
  });

  it('has the spec defaults (§6.2)', () => {
    expect(DEFAULT_SCORING.qualWin).toBe(3);
    expect(DEFAULT_SCORING.rankTiers).toEqual([
      { maxRank: 1, points: 10 },
      { maxRank: 8, points: 5 },
      { maxRank: 16, points: 2 },
    ]);
    expect(DEFAULT_SCORING.alliance).toEqual({ captain: 8, pick1: 6, pick2: 3, pick3: 2, backup: 2 });
    expect(DEFAULT_SCORING.awards.excludedTypes).toEqual([1, 2, 3, 4, 5, 6, 7, 14, 39]);
    expect(DEFAULT_SCORING.oprBonus).toEqual([6, 4, 2]);
  });

  it('rejects non-integer and out-of-range points', () => {
    expect(scoringConfigSchema.safeParse({ ...DEFAULT_SCORING, qualWin: 1.5 }).success).toBe(false);
    expect(scoringConfigSchema.safeParse({ ...DEFAULT_SCORING, qualWin: 1001 }).success).toBe(false);
    expect(scoringConfigSchema.safeParse({ ...DEFAULT_SCORING, qualLoss: -1000 }).success).toBe(true);
  });

  it('rejects rank tiers that are not strictly ascending', () => {
    const bad = { ...DEFAULT_SCORING, rankTiers: [{ maxRank: 8, points: 5 }, { maxRank: 8, points: 2 }] };
    expect(scoringConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('allows oprBonus length 0 to 10 only', () => {
    expect(scoringConfigSchema.safeParse({ ...DEFAULT_SCORING, oprBonus: [] }).success).toBe(true);
    expect(scoringConfigSchema.safeParse({ ...DEFAULT_SCORING, oprBonus: Array(11).fill(1) }).success).toBe(false);
  });

  it('rejects a wrong version', () => {
    expect(scoringConfigSchema.safeParse({ ...DEFAULT_SCORING, version: 2 }).success).toBe(false);
  });

  it('defaultScoring returns an independent copy', () => {
    const copy = defaultScoring();
    copy.rankTiers[0].points = 99;
    expect(DEFAULT_SCORING.rankTiers[0].points).toBe(10);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/scoring/config.test.ts`
Expected: FAIL, cannot resolve `@/lib/scoring/config`.

- [ ] **Step 3: Implement**

`lib/scoring/config.ts`:

```ts
import { z } from 'zod';

const points = z.number().int().min(-1000).max(1000);

export const scoringConfigSchema = z.object({
  version: z.literal(1),
  qualWin: points,
  qualTie: points,
  qualLoss: points,
  rankingPoint: points,
  rankTiers: z
    .array(z.object({ maxRank: z.number().int().min(1).max(1000), points }))
    .max(20)
    .refine((tiers) => tiers.every((t, i) => i === 0 || t.maxRank > tiers[i - 1].maxRank), {
      message: 'Rank tiers must go in ascending order of max rank',
    }),
  alliance: z.object({
    captain: points,
    pick1: points,
    pick2: points,
    pick3: points,
    backup: points,
  }),
  playoffMatchWin: points,
  eventWinner: points,
  eventFinalist: points,
  awards: z.object({
    byType: z.record(z.string().regex(/^\d+$/), points),
    excludedTypes: z.array(z.number().int().min(0)).max(200),
    default: points,
  }),
  oprBonus: z.array(points).max(10),
});

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

export const DEFAULT_SCORING: ScoringConfig = {
  version: 1,
  qualWin: 3,
  qualTie: 1,
  qualLoss: 0,
  rankingPoint: 1,
  rankTiers: [
    { maxRank: 1, points: 10 },
    { maxRank: 8, points: 5 },
    { maxRank: 16, points: 2 },
  ],
  alliance: { captain: 8, pick1: 6, pick2: 3, pick3: 2, backup: 2 },
  playoffMatchWin: 4,
  eventWinner: 15,
  eventFinalist: 8,
  awards: {
    byType: { '0': 10, '9': 8, '10': 6 },
    excludedTypes: [1, 2, 3, 4, 5, 6, 7, 14, 39],
    default: 5,
  },
  oprBonus: [6, 4, 2],
};

export function defaultScoring(): ScoringConfig {
  return structuredClone(DEFAULT_SCORING);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/scoring/config.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/config.ts tests/scoring/config.test.ts
git commit -m "feat: scoring config schema and defaults"
```

---

### Task 3: Team keys and pool merging

**Files:**
- Create: `lib/teams.ts`
- Test: `tests/teams.test.ts`

**Interfaces:**
- Consumes: nothing (the `TeamSimple` shape it needs is declared structurally here so this task does not depend on Task 4).
- Produces:
  - `TEAM_KEY_RE: RegExp`, `EVENT_KEY_RE: RegExp`
  - `isTeamKey(s: string): boolean`
  - `parseTeamInput(input: string): string | null` — human input → team key, or `null` if invalid
  - `normalizeEventKey(input: string): string | null`
  - `teamLabel(teamKey: string): string` — `frc341B` → `341B`
  - `type PoolTeam = { teamKey: string; label: string; nickname: string | null; manual: boolean }`
  - `mergePool(tbaTeams: { key: string; nickname?: string | null }[] | null, extraKeys: string[]): PoolTeam[]` — deduplicated, sorted by number then suffix

- [ ] **Step 1: Write the failing test**

`tests/teams.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isTeamKey, mergePool, normalizeEventKey, parseTeamInput, teamLabel } from '@/lib/teams';

describe('parseTeamInput', () => {
  it('accepts plain numbers', () => {
    expect(parseTeamInput('341')).toBe('frc341');
    expect(parseTeamInput('10157')).toBe('frc10157');
  });

  it('uppercases a letter suffix', () => {
    expect(parseTeamInput('341b')).toBe('frc341B');
  });

  // Review Focus 2
  it('tolerates spaces, leading zeros, and an frc prefix', () => {
    expect(parseTeamInput(' 341b ')).toBe('frc341B');
    expect(parseTeamInput('0341')).toBe('frc341');
    expect(parseTeamInput('frc341')).toBe('frc341');
    expect(parseTeamInput('FRC341B')).toBe('frc341B');
  });

  it('rejects junk', () => {
    for (const bad of ['', '0', '000', '34a1', '341bb', '123456', 'abc', '-5', '3.5', 'frc']) {
      expect(parseTeamInput(bad), bad).toBeNull();
    }
  });
});

describe('isTeamKey', () => {
  it('matches the database check constraint', () => {
    expect(isTeamKey('frc341')).toBe(true);
    expect(isTeamKey('frc341B')).toBe(true);
    expect(isTeamKey('frc0341')).toBe(false);
    expect(isTeamKey('frc341b')).toBe(false);
    expect(isTeamKey('341')).toBe(false);
  });
});

describe('normalizeEventKey', () => {
  it('lowercases and trims', () => {
    expect(normalizeEventKey(' 2025PARR ')).toBe('2025parr');
  });
  it('rejects bad keys', () => {
    expect(normalizeEventKey('parr2025')).toBeNull();
    expect(normalizeEventKey('2025')).toBeNull();
    expect(normalizeEventKey('2025 parr')).toBeNull();
  });
});

describe('teamLabel', () => {
  it('strips the frc prefix', () => {
    expect(teamLabel('frc341B')).toBe('341B');
  });
});

describe('mergePool', () => {
  it('merges TBA teams with manual teams, deduplicated and sorted', () => {
    const pool = mergePool(
      [
        { key: 'frc5181', nickname: 'Explorer Robotics' },
        { key: 'frc341', nickname: 'Miss Daisy' },
        { key: 'frc341B', nickname: 'Miss Daisy B' },
      ],
      ['frc9999', 'frc341', 'frc25'],
    );
    expect(pool.map((t) => t.teamKey)).toEqual(['frc25', 'frc341', 'frc341B', 'frc5181', 'frc9999']);
    expect(pool.find((t) => t.teamKey === 'frc341')).toEqual({
      teamKey: 'frc341',
      label: '341',
      nickname: 'Miss Daisy',
      manual: false,
    });
    expect(pool.find((t) => t.teamKey === 'frc25')).toEqual({
      teamKey: 'frc25',
      label: '25',
      nickname: null,
      manual: true,
    });
  });

  it('treats a null TBA list as empty', () => {
    expect(mergePool(null, ['frc341']).map((t) => t.teamKey)).toEqual(['frc341']);
  });

  it('skips TBA entries with malformed keys', () => {
    expect(mergePool([{ key: 'bogus', nickname: 'x' }], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/teams.test.ts`
Expected: FAIL, cannot resolve `@/lib/teams`.

- [ ] **Step 3: Implement**

`lib/teams.ts`:

```ts
export const TEAM_KEY_RE = /^frc[1-9][0-9]{0,4}[A-Z]?$/;
export const EVENT_KEY_RE = /^[0-9]{4}[a-z0-9]+$/;

export function isTeamKey(s: string): boolean {
  return TEAM_KEY_RE.test(s);
}

/** Turns what a human typed ("341", " 341b ", "frc341") into a team key, or null. */
export function parseTeamInput(input: string): string | null {
  const m = /^(?:frc)?0*([1-9][0-9]{0,4})([a-z]?)$/i.exec(input.trim());
  if (!m) return null;
  return `frc${m[1]}${m[2].toUpperCase()}`;
}

export function normalizeEventKey(input: string): string | null {
  const key = input.trim().toLowerCase();
  return EVENT_KEY_RE.test(key) ? key : null;
}

export function teamLabel(teamKey: string): string {
  return teamKey.replace(/^frc/, '');
}

export type PoolTeam = {
  teamKey: string;
  label: string;
  nickname: string | null;
  manual: boolean;
};

function sortParts(teamKey: string): [number, string] {
  const m = /^frc([0-9]+)([A-Z]?)$/.exec(teamKey);
  return m ? [Number(m[1]), m[2]] : [Number.MAX_SAFE_INTEGER, teamKey];
}

export function mergePool(
  tbaTeams: { key: string; nickname?: string | null }[] | null,
  extraKeys: string[],
): PoolTeam[] {
  const byKey = new Map<string, PoolTeam>();
  for (const t of tbaTeams ?? []) {
    if (!isTeamKey(t.key)) continue;
    byKey.set(t.key, { teamKey: t.key, label: teamLabel(t.key), nickname: t.nickname ?? null, manual: false });
  }
  for (const key of extraKeys) {
    if (!isTeamKey(key) || byKey.has(key)) continue;
    byKey.set(key, { teamKey: key, label: teamLabel(key), nickname: null, manual: true });
  }
  return [...byKey.values()].sort((a, b) => {
    const [an, as] = sortParts(a.teamKey);
    const [bn, bs] = sortParts(b.teamKey);
    return an - bn || as.localeCompare(bs);
  });
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/teams.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/teams.ts tests/teams.test.ts
git commit -m "feat: team key parsing and pool merging"
```

---

### Task 4: TBA types, scoring types, and match helpers

**Files:**
- Create: `lib/tba/types.ts`, `lib/scoring/types.ts`, `lib/scoring/matches.ts`
- Create: `tests/helpers/builders.ts`
- Test: `tests/scoring/matches.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (types): `TeamSimple`, `MatchAlliance`, `MatchSimple`, `RankingRow`, `RankingsResponse`, `Alliance`, `Award`, `OprsResponse`, `TbaEvent`, `EventData` from `@/lib/tba/types`; `CategoryId`, `Line`, `TeamScore`, `RpMethod`, `EventScores`, `Pick`, `Adjustment`, `Player`, `PlayerRoundScore`, `SeasonRow` from `@/lib/scoring/types`.
- Produces (functions) from `@/lib/scoring/matches`:
  - `type Side = 'red' | 'blue'`
  - `hasResult(m: MatchSimple): boolean`
  - `winnerOf(m: MatchSimple): Side | null`
  - `creditedTeams(m: MatchSimple, side: Side): string[]`
  - `qualsComplete(matches: MatchSimple[] | null, alliances: Alliance[] | null): boolean`
- Produces (test builders) from `tests/helpers/builders.ts`: `match(...)`, `rankRow(...)`, `rankings(...)`, `alliance(...)`, `emptyEvent()`.

- [ ] **Step 1: Write the type files**

`lib/tba/types.ts`:

```ts
// Only the TBA fields this app reads. TBA sends more; we ignore the rest.

export type TeamSimple = {
  key: string;
  team_number: number;
  nickname?: string | null;
};

export type MatchAlliance = {
  score: number | null;
  team_keys: string[];
  surrogate_team_keys?: string[] | null;
  dq_team_keys?: string[] | null;
};

export type MatchSimple = {
  key: string;
  comp_level: string; // 'qm' | 'ef' | 'qf' | 'sf' | 'f'
  set_number: number;
  match_number: number;
  alliances: { red: MatchAlliance; blue: MatchAlliance } | null;
  /** 'red' | 'blue' | '' (no winner). May be missing entirely on old data. */
  winning_alliance?: string | null;
};

export type RankingRow = {
  rank: number;
  team_key: string;
  record: { wins: number; losses: number; ties: number } | null;
  matches_played: number;
  extra_stats?: number[] | null;
  sort_orders?: number[] | null;
};

export type RankingsResponse = {
  rankings: RankingRow[] | null;
  extra_stats_info?: { name: string }[] | null;
  sort_order_info?: { name: string }[] | null;
};

export type Alliance = {
  name?: string | null;
  picks: string[];
  backup?: { in: string; out: string } | null;
  status?: { level?: string | null; status?: string | null } | null;
};

export type Award = {
  name: string;
  award_type: number;
  recipient_list: { team_key: string | null; awardee: string | null }[];
};

export type OprsResponse = {
  oprs?: Record<string, number> | null;
};

export type TbaEvent = {
  key: string;
  name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;
  timezone?: string | null;
  event_type?: number;
};

export type EventData = {
  teams: TeamSimple[] | null;
  matches: MatchSimple[] | null;
  rankings: RankingsResponse | null;
  alliances: Alliance[] | null;
  awards: Award[] | null;
  oprs: OprsResponse | null;
};
```

`lib/scoring/types.ts`:

```ts
export type CategoryId =
  | 'qualRecord'
  | 'rankingPoints'
  | 'rank'
  | 'alliance'
  | 'playoffWins'
  | 'eventResult'
  | 'awards'
  | 'oprBonus'
  | 'adjustment';

export type Line = { category: CategoryId; label: string; quantity?: number; points: number };

export type TeamScore = { teamKey: string; total: number; lines: Line[] };

export type RpMethod = 'extra_stats' | 'sort_order_avg' | 'none';

export type EventScores = {
  teams: Map<string, TeamScore>;
  qualsComplete: boolean;
  rpMethod: RpMethod;
};

export type Pick = { pickNumber: number; playerId: string; teamKey: string };

export type Adjustment = {
  id: string;
  playerId: string | null;
  teamKey: string | null;
  points: number;
  reason: string;
};

export type Player = { id: string; name: string };

export type PlayerRoundScore = {
  playerId: string;
  name: string;
  total: number;
  rank: number;
  /** Drafted teams in pick order, each including any team-targeted adjustment lines. */
  teams: TeamScore[];
  /** Player-targeted adjustments. */
  adjustments: Line[];
};

export type SeasonRow = {
  playerId: string;
  name: string;
  total: number;
  rank: number;
  /** One entry per round, in the order rounds were passed in. 0 if the player was not in that round. */
  perRound: number[];
};
```

- [ ] **Step 2: Write the test builders**

`tests/helpers/builders.ts`:

```ts
import type { Alliance, EventData, MatchSimple, RankingRow, RankingsResponse } from '@/lib/tba/types';

type MatchOpts = {
  level?: string;
  set?: number;
  num: number;
  red: string[];
  blue: string[];
  redScore?: number;
  blueScore?: number;
  /** Pass 'absent' to leave winning_alliance off the object entirely. */
  winner?: 'red' | 'blue' | '' | 'absent';
  redSurrogates?: string[];
  blueSurrogates?: string[];
  redDq?: string[];
  blueDq?: string[];
};

/** Builds a match. With no scores given, the match is unplayed (-1 / -1). */
export function match(o: MatchOpts): MatchSimple {
  const level = o.level ?? 'qm';
  const set = o.set ?? 1;
  const redScore = o.redScore ?? -1;
  const blueScore = o.blueScore ?? -1;
  const played = redScore >= 0 && blueScore >= 0;
  const auto = !played ? '' : redScore > blueScore ? 'red' : blueScore > redScore ? 'blue' : '';
  const m: MatchSimple = {
    key: `2099test_${level}${level === 'qm' ? '' : `${set}m`}${o.num}`,
    comp_level: level,
    set_number: set,
    match_number: o.num,
    alliances: {
      red: {
        score: redScore,
        team_keys: o.red,
        surrogate_team_keys: o.redSurrogates ?? [],
        dq_team_keys: o.redDq ?? [],
      },
      blue: {
        score: blueScore,
        team_keys: o.blue,
        surrogate_team_keys: o.blueSurrogates ?? [],
        dq_team_keys: o.blueDq ?? [],
      },
    },
  };
  if (o.winner !== 'absent') m.winning_alliance = o.winner ?? auto;
  return m;
}

export function rankRow(
  rank: number,
  teamKey: string,
  record: [number, number, number] | null,
  extra: Partial<RankingRow> = {},
): RankingRow {
  const played = record ? record[0] + record[1] + record[2] : 0;
  return {
    rank,
    team_key: teamKey,
    record: record ? { wins: record[0], losses: record[1], ties: record[2] } : null,
    matches_played: played,
    extra_stats: [],
    sort_orders: [],
    ...extra,
  };
}

/** Rankings in the modern shape: extra_stats[0] is "Total Ranking Points". */
export function rankings(rows: RankingRow[]): RankingsResponse {
  return {
    rankings: rows,
    extra_stats_info: [{ name: 'Total Ranking Points' }],
    sort_order_info: [{ name: 'Ranking Score' }],
  };
}

export function alliance(picks: string[], extra: Partial<Alliance> = {}): Alliance {
  return { name: null, picks, backup: null, status: null, ...extra };
}

export function emptyEvent(): EventData {
  return { teams: null, matches: null, rankings: null, alliances: null, awards: null, oprs: null };
}
```

- [ ] **Step 3: Write the failing test**

`tests/scoring/matches.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { creditedTeams, hasResult, qualsComplete, winnerOf } from '@/lib/scoring/matches';
import { alliance, match } from '../helpers/builders';

const R = ['frc1', 'frc2', 'frc3'];
const B = ['frc4', 'frc5', 'frc6'];

describe('hasResult', () => {
  it('is false for unplayed matches (-1 scores)', () => {
    expect(hasResult(match({ num: 1, red: R, blue: B }))).toBe(false);
  });
  it('is true when both scores are 0 or more', () => {
    expect(hasResult(match({ num: 1, red: R, blue: B, redScore: 0, blueScore: 0 }))).toBe(true);
  });
  it('is false when alliances or a score is null', () => {
    const m = match({ num: 1, red: R, blue: B, redScore: 10, blueScore: 5 });
    expect(hasResult({ ...m, alliances: null })).toBe(false);
    m.alliances!.red.score = null;
    expect(hasResult(m)).toBe(false);
  });
});

describe('winnerOf', () => {
  it('returns null for unplayed matches', () => {
    expect(winnerOf(match({ num: 1, red: R, blue: B }))).toBeNull();
  });

  it('trusts winning_alliance even when scores disagree (§7.5)', () => {
    const m = match({ num: 1, red: R, blue: B, redScore: 100, blueScore: 120, winner: 'red' });
    expect(winnerOf(m)).toBe('red');
  });

  it('trusts winning_alliance on equal scores (tiebreaker applied by TBA)', () => {
    const m = match({ num: 1, red: R, blue: B, redScore: 50, blueScore: 50, winner: 'blue' });
    expect(winnerOf(m)).toBe('blue');
  });

  it('returns null when winning_alliance is an empty string', () => {
    const m = match({ num: 1, red: R, blue: B, redScore: 156, blueScore: 156, winner: '' });
    expect(winnerOf(m)).toBeNull();
  });

  it('does NOT compare scores when winning_alliance is an empty string', () => {
    const m = match({ num: 1, red: R, blue: B, redScore: 90, blueScore: 10, winner: '' });
    expect(winnerOf(m)).toBeNull();
  });

  it('falls back to comparing scores only when the field is absent', () => {
    expect(winnerOf(match({ num: 1, red: R, blue: B, redScore: 9, blueScore: 3, winner: 'absent' }))).toBe('red');
    expect(winnerOf(match({ num: 1, red: R, blue: B, redScore: 3, blueScore: 9, winner: 'absent' }))).toBe('blue');
    expect(winnerOf(match({ num: 1, red: R, blue: B, redScore: 3, blueScore: 3, winner: 'absent' }))).toBeNull();
  });

  it('treats a null winning_alliance like an absent one', () => {
    const m = match({ num: 1, red: R, blue: B, redScore: 9, blueScore: 3 });
    m.winning_alliance = null;
    expect(winnerOf(m)).toBe('red');
  });
});

describe('creditedTeams', () => {
  it('excludes surrogates and disqualified teams', () => {
    const m = match({
      num: 1, red: R, blue: B, redScore: 10, blueScore: 5,
      redSurrogates: ['frc2'], redDq: ['frc3'],
    });
    expect(creditedTeams(m, 'red')).toEqual(['frc1']);
    expect(creditedTeams(m, 'blue')).toEqual(B);
  });

  it('copes with null surrogate and dq arrays', () => {
    const m = match({ num: 1, red: R, blue: B, redScore: 10, blueScore: 5 });
    m.alliances!.red.surrogate_team_keys = null;
    m.alliances!.red.dq_team_keys = null;
    expect(creditedTeams(m, 'red')).toEqual(R);
  });
});

describe('qualsComplete (§7.6)', () => {
  const played = (n: number) => match({ num: n, red: R, blue: B, redScore: 10, blueScore: 5 });
  const unplayed = (n: number) => match({ num: n, red: R, blue: B });
  const sf = match({ level: 'sf', set: 1, num: 1, red: R, blue: B });

  it('is true when alliances exist, even with unplayed quals', () => {
    expect(qualsComplete([played(1), unplayed(2)], [alliance(R)])).toBe(true);
  });

  it('ignores alliances that have no picks', () => {
    expect(qualsComplete([played(1), unplayed(2)], [alliance([])])).toBe(false);
  });

  it('is true when all quals are played and a playoff match is scheduled', () => {
    expect(qualsComplete([played(1), played(2), sf], null)).toBe(true);
  });

  it('is false when all quals are played but no playoff match exists yet', () => {
    expect(qualsComplete([played(1), played(2)], null)).toBe(false);
  });

  it('is false when a qual is unplayed', () => {
    expect(qualsComplete([played(1), unplayed(2), sf], null)).toBe(false);
  });

  it('is false with no data', () => {
    expect(qualsComplete(null, null)).toBe(false);
    expect(qualsComplete([], [])).toBe(false);
    expect(qualsComplete([sf], null)).toBe(false);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run tests/scoring/matches.test.ts`
Expected: FAIL, cannot resolve `@/lib/scoring/matches`.

- [ ] **Step 5: Implement**

`lib/scoring/matches.ts`:

```ts
import type { Alliance, MatchSimple } from '@/lib/tba/types';

export type Side = 'red' | 'blue';

function scores(m: MatchSimple): { red: number; blue: number } | null {
  const red = m.alliances?.red?.score;
  const blue = m.alliances?.blue?.score;
  if (typeof red !== 'number' || typeof blue !== 'number') return null;
  if (red < 0 || blue < 0) return null; // TBA uses -1 for unplayed
  return { red, blue };
}

export function hasResult(m: MatchSimple): boolean {
  return scores(m) !== null;
}

/**
 * Who won. Trusts TBA's winning_alliance whenever it is present, because TBA
 * applies game tiebreakers we can't see. '' means "no winner" and is final.
 * Scores are only compared when the field is missing altogether (§7.5).
 */
export function winnerOf(m: MatchSimple): Side | null {
  const s = scores(m);
  if (!s) return null;
  const w = m.winning_alliance;
  if (w === 'red' || w === 'blue') return w;
  if (w === '') return null;
  if (s.red > s.blue) return 'red';
  if (s.blue > s.red) return 'blue';
  return null;
}

/** Teams on a side that get credit for the match: not surrogates, not disqualified. */
export function creditedTeams(m: MatchSimple, side: Side): string[] {
  const a = m.alliances?.[side];
  if (!a) return [];
  const excluded = new Set([...(a.surrogate_team_keys ?? []), ...(a.dq_team_keys ?? [])]);
  return (a.team_keys ?? []).filter((k) => !excluded.has(k));
}

export function qualsComplete(matches: MatchSimple[] | null, alliances: Alliance[] | null): boolean {
  if ((alliances ?? []).some((a) => (a.picks ?? []).length > 0)) return true;
  const all = matches ?? [];
  const quals = all.filter((m) => m.comp_level === 'qm');
  const hasPlayoff = all.some((m) => m.comp_level !== 'qm');
  return quals.length > 0 && quals.every(hasResult) && hasPlayoff;
}
```

- [ ] **Step 6: Run it and watch it pass**

Run: `npx vitest run tests/scoring/matches.test.ts && npm run typecheck`
Expected: PASS; typecheck prints nothing.

- [ ] **Step 7: Commit**

```bash
git add lib/tba/types.ts lib/scoring/types.ts lib/scoring/matches.ts tests/helpers/builders.ts tests/scoring/matches.test.ts
git commit -m "feat: TBA types and match result helpers"
```

---

### Task 5: Qualification scoring (record, ranking points, rank tiers)

**Files:**
- Create: `lib/scoring/quals.ts`
- Test: `tests/scoring/quals.test.ts`

**Interfaces:**
- Consumes: `hasResult`, `winnerOf`, `creditedTeams` from `@/lib/scoring/matches`; `ScoringConfig` from `@/lib/scoring/config`; `Line`, `RpMethod` from `@/lib/scoring/types`; TBA types.
- Produces:
  - `type QualRecord = { wins: number; losses: number; ties: number }`
  - `qualRecords(rankings: RankingsResponse | null, matches: MatchSimple[] | null): Map<string, QualRecord>`
  - `extractRp(rankings: RankingsResponse | null): { method: RpMethod; byTeam: Map<string, number> }`
  - `rankTierPoints(rank: number, tiers: { maxRank: number; points: number }[]): number`
  - `qualLines(data: { rankings: RankingsResponse | null; matches: MatchSimple[] | null }, config: ScoringConfig, qualsDone: boolean): { lines: Map<string, Line[]>; rpMethod: RpMethod }`

- [ ] **Step 1: Write the failing test**

`tests/scoring/quals.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { extractRp, qualLines, qualRecords, rankTierPoints } from '@/lib/scoring/quals';
import type { RankingsResponse } from '@/lib/tba/types';
import { match, rankRow, rankings } from '../helpers/builders';

const R = ['frc1', 'frc2', 'frc3'];
const B = ['frc4', 'frc5', 'frc6'];

describe('rankTierPoints', () => {
  const tiers = DEFAULT_SCORING.rankTiers;
  it('scores the boundaries 1, 8, 9, 16, 17', () => {
    expect(rankTierPoints(1, tiers)).toBe(10);
    expect(rankTierPoints(2, tiers)).toBe(5);
    expect(rankTierPoints(8, tiers)).toBe(5);
    expect(rankTierPoints(9, tiers)).toBe(2);
    expect(rankTierPoints(16, tiers)).toBe(2);
    expect(rankTierPoints(17, tiers)).toBe(0);
  });
  it('returns 0 for no tiers or a nonsense rank', () => {
    expect(rankTierPoints(1, [])).toBe(0);
    expect(rankTierPoints(0, tiers)).toBe(0);
    expect(rankTierPoints(Number.NaN, tiers)).toBe(0);
  });
});

describe('extractRp (§7.4)', () => {
  it('branch 1: reads "Total Ranking Points" from extra_stats', () => {
    const r: RankingsResponse = {
      rankings: [rankRow(1, 'frc1', [7, 2, 0], { extra_stats: [4, 22], sort_orders: [2.44] })],
      extra_stats_info: [{ name: 'Something Else' }, { name: 'Total Ranking Points' }],
      sort_order_info: [{ name: 'Ranking Score' }],
    };
    const out = extractRp(r);
    expect(out.method).toBe('extra_stats');
    expect(out.byTeam.get('frc1')).toBe(22);
  });

  it('branch 2: multiplies the average by matches played and rounds', () => {
    const r: RankingsResponse = {
      rankings: [rankRow(1, 'frc1', [7, 2, 0], { sort_orders: [2.4444] })],
      extra_stats_info: [],
      sort_order_info: [{ name: 'Ranking Score' }],
    };
    const out = extractRp(r);
    expect(out.method).toBe('sort_order_avg');
    expect(out.byTeam.get('frc1')).toBe(22); // 2.4444 * 9 = 21.9996
  });

  it('branch 2 also matches "Ranking Points" in the sort order name', () => {
    const r: RankingsResponse = {
      rankings: [rankRow(1, 'frc1', [2, 0, 0], { sort_orders: [3] })],
      extra_stats_info: null,
      sort_order_info: [{ name: 'Avg Ranking Points' }],
    };
    expect(extractRp(r)).toMatchObject({ method: 'sort_order_avg' });
    expect(extractRp(r).byTeam.get('frc1')).toBe(6);
  });

  it('branch 3: unknown shape gives method "none" and no RP', () => {
    const r: RankingsResponse = {
      rankings: [rankRow(1, 'frc1', [2, 0, 0], { sort_orders: [55] })],
      extra_stats_info: [],
      sort_order_info: [{ name: 'Qual Average' }],
    };
    const out = extractRp(r);
    expect(out.method).toBe('none');
    expect(out.byTeam.size).toBe(0);
  });

  it('handles a null response, null arrays, and null sort_order_info', () => {
    expect(extractRp(null).method).toBe('none');
    expect(extractRp({ rankings: null }).method).toBe('none');
    const r: RankingsResponse = {
      rankings: [rankRow(1, 'frc1', [1, 0, 0])],
      extra_stats_info: null,
      sort_order_info: null,
    };
    expect(extractRp(r).method).toBe('none');
  });

  it('treats a missing number as 0 RP', () => {
    const r = rankings([rankRow(1, 'frc1', [1, 0, 0], { extra_stats: null })]);
    expect(extractRp(r).byTeam.get('frc1')).toBe(0);
  });
});

describe('qualRecords', () => {
  it('uses the record from rankings when present', () => {
    const recs = qualRecords(rankings([rankRow(1, 'frc1', [7, 2, 1])]), null);
    expect(recs.get('frc1')).toEqual({ wins: 7, losses: 2, ties: 1 });
  });

  it('falls back to matches when rankings are null', () => {
    const matches = [
      match({ num: 1, red: R, blue: B, redScore: 10, blueScore: 5 }),
      match({ num: 2, red: R, blue: B, redScore: 7, blueScore: 7 }),
      match({ num: 3, red: R, blue: B }), // unplayed, ignored
      match({ level: 'sf', set: 1, num: 1, red: R, blue: B, redScore: 1, blueScore: 9 }), // playoff, ignored
    ];
    const recs = qualRecords(null, matches);
    expect(recs.get('frc1')).toEqual({ wins: 1, losses: 0, ties: 1 });
    expect(recs.get('frc4')).toEqual({ wins: 0, losses: 1, ties: 1 });
  });

  it('falls back per team when only that team has a null record', () => {
    const r = rankings([rankRow(1, 'frc1', [5, 0, 0]), rankRow(2, 'frc4', null)]);
    const matches = [match({ num: 1, red: R, blue: B, redScore: 10, blueScore: 5 })];
    const recs = qualRecords(r, matches);
    expect(recs.get('frc1')).toEqual({ wins: 5, losses: 0, ties: 0 }); // rankings win
    expect(recs.get('frc4')).toEqual({ wins: 0, losses: 1, ties: 0 }); // from matches
  });

  it('skips surrogates and disqualified teams in the fallback', () => {
    const matches = [
      match({ num: 1, red: R, blue: B, redScore: 10, blueScore: 5, redSurrogates: ['frc1'], blueDq: ['frc4'] }),
    ];
    const recs = qualRecords(null, matches);
    expect(recs.has('frc1')).toBe(false);
    expect(recs.has('frc4')).toBe(false);
    expect(recs.get('frc2')).toEqual({ wins: 1, losses: 0, ties: 0 });
  });
});

describe('qualLines', () => {
  it('builds record, RP, and rank lines with the spec labels', () => {
    const r = rankings([rankRow(3, 'frc341', [7, 2, 0], { extra_stats: [22] })]);
    const { lines, rpMethod } = qualLines({ rankings: r, matches: null }, DEFAULT_SCORING, false);
    expect(rpMethod).toBe('extra_stats');
    expect(lines.get('frc341')).toEqual([
      { category: 'qualRecord', label: 'Qual record 7-2-0', points: 21 },
      { category: 'rankingPoints', label: 'Ranking points 22', quantity: 22, points: 22 },
      { category: 'rank', label: 'Current rank #3', quantity: 3, points: 5 },
    ]);
  });

  it('says "Final rank" once quals are complete', () => {
    const r = rankings([rankRow(1, 'frc1', [9, 0, 0], { extra_stats: [30] })]);
    const { lines } = qualLines({ rankings: r, matches: null }, DEFAULT_SCORING, true);
    expect(lines.get('frc1')![2]).toEqual({ category: 'rank', label: 'Final rank #1', quantity: 1, points: 10 });
  });

  it('applies qualTie and a negative qualLoss', () => {
    const config = { ...DEFAULT_SCORING, qualLoss: -1 };
    const r = rankings([rankRow(20, 'frc9', [1, 4, 2], { extra_stats: [5] })]);
    const { lines } = qualLines({ rankings: r, matches: null }, config, false);
    expect(lines.get('frc9')![0].points).toBe(1 * 3 + 2 * 1 + 4 * -1);
  });

  // Review Focus 1
  it('gives no rank points when no matches have been played', () => {
    const r = rankings([rankRow(1, 'frc1', [0, 0, 0], { extra_stats: [0] })]);
    const { lines } = qualLines({ rankings: r, matches: null }, DEFAULT_SCORING, false);
    expect((lines.get('frc1') ?? []).filter((l) => l.category === 'rank')).toEqual([]);
  });

  it('returns nothing and never throws when everything is null', () => {
    const { lines, rpMethod } = qualLines({ rankings: null, matches: null }, DEFAULT_SCORING, false);
    expect(lines.size).toBe(0);
    expect(rpMethod).toBe('none');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/scoring/quals.test.ts`
Expected: FAIL, cannot resolve `@/lib/scoring/quals`.

- [ ] **Step 3: Implement**

`lib/scoring/quals.ts`:

```ts
import type { ScoringConfig } from '@/lib/scoring/config';
import { creditedTeams, hasResult, winnerOf } from '@/lib/scoring/matches';
import type { Line, RpMethod } from '@/lib/scoring/types';
import type { MatchSimple, RankingsResponse } from '@/lib/tba/types';

export type QualRecord = { wins: number; losses: number; ties: number };

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function rankTierPoints(rank: number, tiers: { maxRank: number; points: number }[]): number {
  if (!Number.isFinite(rank) || rank < 1) return 0;
  for (const tier of tiers) {
    if (tier.maxRank >= rank) return tier.points;
  }
  return 0;
}

export function extractRp(rankings: RankingsResponse | null): {
  method: RpMethod;
  byTeam: Map<string, number>;
} {
  const rows = rankings?.rankings ?? [];
  const byTeam = new Map<string, number>();

  const extraIndex = (rankings?.extra_stats_info ?? []).findIndex((i) =>
    (i?.name ?? '').toLowerCase().includes('total ranking points'),
  );
  if (extraIndex >= 0) {
    for (const row of rows) byTeam.set(row.team_key, Math.round(num(row.extra_stats?.[extraIndex])));
    return { method: 'extra_stats', byTeam };
  }

  const firstSort = (rankings?.sort_order_info?.[0]?.name ?? '').toLowerCase();
  if (firstSort.includes('ranking score') || firstSort.includes('ranking points')) {
    for (const row of rows) {
      byTeam.set(row.team_key, Math.round(num(row.sort_orders?.[0]) * num(row.matches_played)));
    }
    return { method: 'sort_order_avg', byTeam };
  }

  return { method: 'none', byTeam };
}

function recordsFromMatches(matches: MatchSimple[] | null): Map<string, QualRecord> {
  const out = new Map<string, QualRecord>();
  const rec = (k: string) => {
    let r = out.get(k);
    if (!r) {
      r = { wins: 0, losses: 0, ties: 0 };
      out.set(k, r);
    }
    return r;
  };
  for (const m of matches ?? []) {
    if (m.comp_level !== 'qm' || !hasResult(m)) continue;
    const winner = winnerOf(m);
    for (const side of ['red', 'blue'] as const) {
      for (const team of creditedTeams(m, side)) {
        if (winner === null) rec(team).ties += 1;
        else if (winner === side) rec(team).wins += 1;
        else rec(team).losses += 1;
      }
    }
  }
  return out;
}

export function qualRecords(
  rankings: RankingsResponse | null,
  matches: MatchSimple[] | null,
): Map<string, QualRecord> {
  const out = recordsFromMatches(matches);
  for (const row of rankings?.rankings ?? []) {
    if (row.record) {
      out.set(row.team_key, {
        wins: num(row.record.wins),
        losses: num(row.record.losses),
        ties: num(row.record.ties),
      });
    }
  }
  return out;
}

export function qualLines(
  data: { rankings: RankingsResponse | null; matches: MatchSimple[] | null },
  config: ScoringConfig,
  qualsDone: boolean,
): { lines: Map<string, Line[]>; rpMethod: RpMethod } {
  const lines = new Map<string, Line[]>();
  const push = (team: string, line: Line) => {
    const list = lines.get(team) ?? [];
    list.push(line);
    lines.set(team, list);
  };

  for (const [team, r] of qualRecords(data.rankings, data.matches)) {
    push(team, {
      category: 'qualRecord',
      label: `Qual record ${r.wins}-${r.losses}-${r.ties}`,
      points: r.wins * config.qualWin + r.ties * config.qualTie + r.losses * config.qualLoss,
    });
  }

  const rp = extractRp(data.rankings);
  for (const [team, total] of rp.byTeam) {
    push(team, {
      category: 'rankingPoints',
      label: `Ranking points ${total}`,
      quantity: total,
      points: total * config.rankingPoint,
    });
  }

  for (const row of data.rankings?.rankings ?? []) {
    if (num(row.matches_played) <= 0) continue; // a rank before any match is a placeholder
    push(row.team_key, {
      category: 'rank',
      label: `${qualsDone ? 'Final' : 'Current'} rank #${row.rank}`,
      quantity: row.rank,
      points: rankTierPoints(row.rank, config.rankTiers),
    });
  }

  return { lines, rpMethod: rp.method };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/scoring/quals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/quals.ts tests/scoring/quals.test.ts
git commit -m "feat: qualification scoring (record, RP, rank tiers)"
```

---

### Task 6: Alliance selection, playoff wins, winner and finalist

**Files:**
- Create: `lib/scoring/playoffs.ts`
- Test: `tests/scoring/playoffs.test.ts`

**Interfaces:**
- Consumes: `hasResult`, `winnerOf`, `creditedTeams` from `@/lib/scoring/matches`; `ScoringConfig`; `Line`; TBA types; builders from `tests/helpers/builders.ts`.
- Produces:
  - `allianceMembers(a: Alliance): string[]` — `picks` plus `backup.in`
  - `allianceLines(alliances: Alliance[] | null, config: ScoringConfig): Map<string, Line>`
  - `playoffLines(matches: MatchSimple[] | null, config: ScoringConfig): Map<string, Line>`
  - `finalsResult(alliances: Alliance[] | null, matches: MatchSimple[] | null): { winner: number | null; finalist: number | null }` — values are **indexes into `alliances`** (Alliance 3 is index 2)
  - `eventResultLines(alliances: Alliance[] | null, matches: MatchSimple[] | null, config: ScoringConfig): Map<string, Line>`

- [ ] **Step 1: Write the failing test**

`tests/scoring/playoffs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import {
  allianceLines,
  allianceMembers,
  eventResultLines,
  finalsResult,
  playoffLines,
} from '@/lib/scoring/playoffs';
import { alliance, match } from '../helpers/builders';

const A0 = ['frc1', 'frc2', 'frc3'];
const A1 = ['frc4', 'frc5', 'frc6'];

describe('allianceMembers', () => {
  it('is picks plus the backup robot that came in', () => {
    expect(allianceMembers(alliance(A0, { backup: { in: 'frc9', out: 'frc3' } }))).toEqual([...A0, 'frc9']);
    expect(allianceMembers(alliance(A0))).toEqual(A0);
  });
});

describe('allianceLines (§3.4.3)', () => {
  it('scores captain, first, second, and third pick', () => {
    const lines = allianceLines([alliance(['frc4', 'frc5', 'frc6', 'frc7'])], DEFAULT_SCORING);
    expect(lines.get('frc4')).toEqual({ category: 'alliance', label: 'Alliance captain', points: 8 });
    expect(lines.get('frc5')).toEqual({ category: 'alliance', label: 'Alliance first pick', points: 6 });
    expect(lines.get('frc6')).toEqual({ category: 'alliance', label: 'Alliance second pick', points: 3 });
    expect(lines.get('frc7')).toEqual({ category: 'alliance', label: 'Alliance third pick', points: 2 });
  });

  it('scores a backup robot, and the robot it replaced keeps its pick points', () => {
    const lines = allianceLines([alliance(A0, { backup: { in: 'frc9', out: 'frc3' } })], DEFAULT_SCORING);
    expect(lines.get('frc9')).toEqual({ category: 'alliance', label: 'Backup robot', points: 2 });
    expect(lines.get('frc3')!.points).toBe(3);
  });

  it('scores a team listed twice only once, at its highest-valued position', () => {
    const lines = allianceLines([alliance(['frc4', 'frc1', 'frc5']), alliance(['frc1', 'frc2', 'frc3'])], DEFAULT_SCORING);
    expect(lines.get('frc1')).toEqual({ category: 'alliance', label: 'Alliance captain', points: 8 });
  });

  it('ignores picks beyond the fourth', () => {
    const lines = allianceLines([alliance(['frc1', 'frc2', 'frc3', 'frc4', 'frc5'])], DEFAULT_SCORING);
    expect(lines.has('frc5')).toBe(false);
  });

  it('handles null and empty input', () => {
    expect(allianceLines(null, DEFAULT_SCORING).size).toBe(0);
    expect(allianceLines([], DEFAULT_SCORING).size).toBe(0);
  });
});

describe('playoffLines (§3.4.4)', () => {
  it('counts wins per team that played, skipping quals', () => {
    const matches = [
      match({ num: 1, red: A0, blue: A1, redScore: 50, blueScore: 10 }), // qual, ignored
      match({ level: 'sf', set: 1, num: 1, red: A0, blue: A1, redScore: 50, blueScore: 10 }),
      match({ level: 'sf', set: 2, num: 1, red: A0, blue: A1, redScore: 5, blueScore: 10 }),
      match({ level: 'f', set: 1, num: 1, red: A0, blue: A1, redScore: 50, blueScore: 10 }),
    ];
    const lines = playoffLines(matches, DEFAULT_SCORING);
    expect(lines.get('frc1')).toEqual({ category: 'playoffWins', label: 'Playoff wins ×2', quantity: 2, points: 8 });
    expect(lines.get('frc4')).toEqual({ category: 'playoffWins', label: 'Playoff wins ×1', quantity: 1, points: 4 });
  });

  it('awards nothing for a tied match with no winner (2025parr Match 3)', () => {
    const matches = [
      match({ level: 'sf', set: 3, num: 1, red: A0, blue: A1, redScore: 156, blueScore: 156, winner: '' }),
    ];
    expect(playoffLines(matches, DEFAULT_SCORING).size).toBe(0);
  });

  it('skips surrogates and disqualified teams', () => {
    const matches = [
      match({
        level: 'sf', set: 1, num: 1, red: A0, blue: A1, redScore: 50, blueScore: 10,
        redSurrogates: ['frc2'], redDq: ['frc3'],
      }),
    ];
    const lines = playoffLines(matches, DEFAULT_SCORING);
    expect([...lines.keys()]).toEqual(['frc1']);
  });

  it('ignores unplayed playoff matches and null input', () => {
    expect(playoffLines([match({ level: 'f', set: 1, num: 1, red: A0, blue: A1 })], DEFAULT_SCORING).size).toBe(0);
    expect(playoffLines(null, DEFAULT_SCORING).size).toBe(0);
  });
});

describe('finalsResult (§7.7)', () => {
  it('primary: reads winner and finalist from alliance status', () => {
    const alliances = [
      alliance(['frc1', 'frc2', 'frc3'], { status: { level: 'sf', status: 'eliminated' } }),
      alliance(['frc4', 'frc5', 'frc6'], { status: { level: 'sf', status: 'eliminated' } }),
      alliance(['frc7', 'frc8', 'frc9'], { status: { level: 'f', status: 'won' } }),
      alliance(['frc10', 'frc11', 'frc12'], { status: { level: 'f', status: 'eliminated' } }),
    ];
    expect(finalsResult(alliances, null)).toEqual({ winner: 2, finalist: 3 });
  });

  it('gives nothing while the finals are still being played', () => {
    const alliances = [
      alliance(A0, { status: { level: 'f', status: 'playing' } }),
      alliance(A1, { status: { level: 'f', status: 'playing' } }),
    ];
    expect(finalsResult(alliances, [])).toEqual({ winner: null, finalist: null });
  });

  it('fallback: tallies per alliance even when colors swap between matches', () => {
    const alliances = [alliance(A0), alliance(A1)];
    const matches = [
      match({ level: 'f', set: 1, num: 1, red: A0, blue: A1, redScore: 80, blueScore: 70 }),
      match({ level: 'f', set: 1, num: 2, red: A1, blue: A0, redScore: 60, blueScore: 90 }), // A0 is blue now
    ];
    expect(finalsResult(alliances, matches)).toEqual({ winner: 0, finalist: 1 });
  });

  it('fallback: handles a three-match final', () => {
    const alliances = [alliance(A0), alliance(A1)];
    const matches = [
      match({ level: 'f', set: 1, num: 3, red: A0, blue: A1, redScore: 10, blueScore: 70 }),
      match({ level: 'f', set: 1, num: 1, red: A0, blue: A1, redScore: 80, blueScore: 70 }),
      match({ level: 'f', set: 1, num: 2, red: A0, blue: A1, redScore: 10, blueScore: 70 }),
    ];
    expect(finalsResult(alliances, matches)).toEqual({ winner: 1, finalist: 0 });
  });

  it('fallback: no result until someone has two finals wins', () => {
    const alliances = [alliance(A0), alliance(A1)];
    const matches = [
      match({ level: 'f', set: 1, num: 1, red: A0, blue: A1, redScore: 80, blueScore: 70 }),
      match({ level: 'f', set: 1, num: 2, red: A0, blue: A1, redScore: 70, blueScore: 70, winner: '' }),
    ];
    expect(finalsResult(alliances, matches)).toEqual({ winner: null, finalist: null });
  });

  it('fallback: recognizes an alliance playing with its backup robot', () => {
    const alliances = [alliance(A0, { backup: { in: 'frc9', out: 'frc3' } }), alliance(A1)];
    const lineup = ['frc1', 'frc2', 'frc9'];
    const matches = [
      match({ level: 'f', set: 1, num: 1, red: lineup, blue: A1, redScore: 80, blueScore: 70 }),
      match({ level: 'f', set: 1, num: 2, red: lineup, blue: A1, redScore: 80, blueScore: 70 }),
    ];
    expect(finalsResult(alliances, matches)).toEqual({ winner: 0, finalist: 1 });
  });

  it('fallback: ignores a side that matches no alliance', () => {
    const alliances = [alliance(A0)];
    const strangers = ['frc77', 'frc78', 'frc79'];
    const matches = [
      match({ level: 'f', set: 1, num: 1, red: strangers, blue: A0, redScore: 1, blueScore: 70 }),
      match({ level: 'f', set: 1, num: 2, red: strangers, blue: A0, redScore: 1, blueScore: 70 }),
    ];
    expect(finalsResult(alliances, matches)).toEqual({ winner: 0, finalist: null });
  });

  it('ignores non-finals matches in the fallback', () => {
    const alliances = [alliance(A0), alliance(A1)];
    const matches = [
      match({ level: 'sf', set: 1, num: 1, red: A0, blue: A1, redScore: 80, blueScore: 70 }),
      match({ level: 'sf', set: 2, num: 1, red: A0, blue: A1, redScore: 80, blueScore: 70 }),
    ];
    expect(finalsResult(alliances, matches)).toEqual({ winner: null, finalist: null });
  });

  it('handles null input', () => {
    expect(finalsResult(null, null)).toEqual({ winner: null, finalist: null });
  });
});

describe('eventResultLines', () => {
  it('gives winner and finalist points to every member, including 4th pick and backup', () => {
    const alliances = [
      alliance(['frc1', 'frc2', 'frc3', 'frc4'], {
        backup: { in: 'frc9', out: 'frc3' },
        status: { level: 'f', status: 'won' },
      }),
      alliance(['frc5', 'frc6', 'frc7'], { status: { level: 'f', status: 'eliminated' } }),
    ];
    const lines = eventResultLines(alliances, null, DEFAULT_SCORING);
    for (const k of ['frc1', 'frc2', 'frc3', 'frc4', 'frc9']) {
      expect(lines.get(k), k).toEqual({ category: 'eventResult', label: 'Event winner', points: 15 });
    }
    for (const k of ['frc5', 'frc6', 'frc7']) {
      expect(lines.get(k), k).toEqual({ category: 'eventResult', label: 'Event finalist', points: 8 });
    }
  });

  it('gives nothing when unresolved', () => {
    expect(eventResultLines([alliance(A0), alliance(A1)], [], DEFAULT_SCORING).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/scoring/playoffs.test.ts`
Expected: FAIL, cannot resolve `@/lib/scoring/playoffs`.

- [ ] **Step 3: Implement**

`lib/scoring/playoffs.ts`:

```ts
import type { ScoringConfig } from '@/lib/scoring/config';
import { creditedTeams, hasResult, winnerOf } from '@/lib/scoring/matches';
import type { Line } from '@/lib/scoring/types';
import type { Alliance, MatchSimple } from '@/lib/tba/types';

export function allianceMembers(a: Alliance): string[] {
  const members = [...(a.picks ?? [])];
  const backup = a.backup?.in;
  if (backup && !members.includes(backup)) members.push(backup);
  return members;
}

export function allianceLines(alliances: Alliance[] | null, config: ScoringConfig): Map<string, Line> {
  const positions: { label: string; points: number }[] = [
    { label: 'Alliance captain', points: config.alliance.captain },
    { label: 'Alliance first pick', points: config.alliance.pick1 },
    { label: 'Alliance second pick', points: config.alliance.pick2 },
    { label: 'Alliance third pick', points: config.alliance.pick3 },
  ];
  const out = new Map<string, Line>();
  // A team should only ever appear once. If the data is inconsistent, keep its best position.
  const offer = (team: string, label: string, points: number) => {
    const existing = out.get(team);
    if (!existing || points > existing.points) out.set(team, { category: 'alliance', label, points });
  };
  for (const a of alliances ?? []) {
    (a.picks ?? []).slice(0, positions.length).forEach((team, i) => {
      offer(team, positions[i].label, positions[i].points);
    });
  }
  for (const a of alliances ?? []) {
    if (a.backup?.in) offer(a.backup.in, 'Backup robot', config.alliance.backup);
  }
  return out;
}

export function playoffLines(matches: MatchSimple[] | null, config: ScoringConfig): Map<string, Line> {
  const wins = new Map<string, number>();
  for (const m of matches ?? []) {
    if (m.comp_level === 'qm' || !hasResult(m)) continue;
    const winner = winnerOf(m);
    if (!winner) continue;
    for (const team of creditedTeams(m, winner)) wins.set(team, (wins.get(team) ?? 0) + 1);
  }
  const out = new Map<string, Line>();
  for (const [team, n] of wins) {
    out.set(team, {
      category: 'playoffWins',
      label: `Playoff wins ×${n}`,
      quantity: n,
      points: n * config.playoffMatchWin,
    });
  }
  return out;
}

type Finals = { winner: number | null; finalist: number | null };

function fromStatus(alliances: Alliance[]): Finals {
  let winner: number | null = null;
  let finalist: number | null = null;
  alliances.forEach((a, i) => {
    if (a.status?.level !== 'f') return;
    if (a.status.status === 'won' && winner === null) winner = i;
    if (a.status.status === 'eliminated' && finalist === null) finalist = i;
  });
  return { winner, finalist };
}

/** Which alliance is this side of a match? Needs at least 2 teams in common. */
function allianceForSide(teamKeys: string[], alliances: Alliance[]): number | null {
  let best: number | null = null;
  let bestOverlap = 1;
  alliances.forEach((a, i) => {
    const members = new Set(allianceMembers(a));
    const overlap = teamKeys.filter((k) => members.has(k)).length;
    if (overlap > bestOverlap) {
      best = i;
      bestOverlap = overlap;
    }
  });
  return best;
}

function fromFinalsMatches(alliances: Alliance[], matches: MatchSimple[]): Finals {
  const finals = matches
    .filter((m) => m.comp_level === 'f' && hasResult(m))
    .sort((a, b) => a.set_number - b.set_number || a.match_number - b.match_number);

  const wins = new Map<number, number>();
  const appeared: number[] = [];
  let winner: number | null = null;

  for (const m of finals) {
    const sides = {
      red: allianceForSide(m.alliances?.red?.team_keys ?? [], alliances),
      blue: allianceForSide(m.alliances?.blue?.team_keys ?? [], alliances),
    };
    for (const idx of [sides.red, sides.blue]) {
      if (idx !== null && !appeared.includes(idx)) appeared.push(idx);
    }
    const w = winnerOf(m);
    const idx = w ? sides[w] : null;
    if (idx === null) continue;
    const total = (wins.get(idx) ?? 0) + 1;
    wins.set(idx, total);
    if (total >= 2 && winner === null) winner = idx;
  }

  if (winner === null) return { winner: null, finalist: null };
  const finalist = appeared.find((i) => i !== winner) ?? null;
  return { winner, finalist };
}

export function finalsResult(alliances: Alliance[] | null, matches: MatchSimple[] | null): Finals {
  const list = alliances ?? [];
  const primary = fromStatus(list);
  if (primary.winner !== null && primary.finalist !== null) return primary;

  const fallback = fromFinalsMatches(list, matches ?? []);
  const winner = primary.winner ?? fallback.winner;
  let finalist = primary.finalist ?? fallback.finalist;
  if (finalist === winner) finalist = null;
  return { winner, finalist };
}

export function eventResultLines(
  alliances: Alliance[] | null,
  matches: MatchSimple[] | null,
  config: ScoringConfig,
): Map<string, Line> {
  const out = new Map<string, Line>();
  const list = alliances ?? [];
  const { winner, finalist } = finalsResult(list, matches);
  if (finalist !== null) {
    for (const team of allianceMembers(list[finalist])) {
      out.set(team, { category: 'eventResult', label: 'Event finalist', points: config.eventFinalist });
    }
  }
  if (winner !== null) {
    for (const team of allianceMembers(list[winner])) {
      out.set(team, { category: 'eventResult', label: 'Event winner', points: config.eventWinner });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/scoring/playoffs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/playoffs.ts tests/scoring/playoffs.test.ts
git commit -m "feat: alliance, playoff, and winner/finalist scoring"
```

---

### Task 7: Awards and the OPR bonus

**Files:**
- Create: `lib/scoring/bonus.ts`
- Test: `tests/scoring/bonus.test.ts`

**Interfaces:**
- Consumes: `ScoringConfig`; `Line`; `Award`, `OprsResponse` from `@/lib/tba/types`.
- Produces:
  - `awardLines(awards: Award[] | null, config: ScoringConfig): Map<string, Line[]>`
  - `oprRanks(oprs: OprsResponse | null): Map<string, number>` — competition ranking (1,1,3)
  - `oprLines(oprs: OprsResponse | null, config: ScoringConfig, qualsDone: boolean): Map<string, Line>`

- [ ] **Step 1: Write the failing test**

`tests/scoring/bonus.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { awardLines, oprLines, oprRanks } from '@/lib/scoring/bonus';
import type { Award } from '@/lib/tba/types';

function award(type: number, name: string, teams: (string | null)[]): Award {
  return {
    name,
    award_type: type,
    recipient_list: teams.map((t) => ({ team_key: t, awardee: t ? null : 'A Person' })),
  };
}

describe('awardLines (§3.4.5)', () => {
  it('scores Impact, Engineering Inspiration, and Rookie All-Star by type', () => {
    const lines = awardLines(
      [
        award(0, 'Impact Award', ['frc1']),
        award(9, 'Engineering Inspiration Award', ['frc2']),
        award(10, 'Rookie All-Star Award', ['frc3']),
      ],
      DEFAULT_SCORING,
    );
    expect(lines.get('frc1')).toEqual([{ category: 'awards', label: 'Impact Award', points: 10 }]);
    expect(lines.get('frc2')![0].points).toBe(8);
    expect(lines.get('frc3')![0].points).toBe(6);
  });

  it('scores any other team award at the default', () => {
    const lines = awardLines([award(29, 'Industrial Design Award', ['frc1'])], DEFAULT_SCORING);
    expect(lines.get('frc1')).toEqual([{ category: 'awards', label: 'Industrial Design Award', points: 5 }]);
  });

  it('excludes winner, finalist, individual, and seed awards', () => {
    const excluded = [1, 2, 3, 4, 5, 6, 7, 14, 39];
    const awards = excluded.map((t) => award(t, `Type ${t}`, ['frc1']));
    expect(awardLines(awards, DEFAULT_SCORING).size).toBe(0);
  });

  it('skips recipients with no team', () => {
    expect(awardLines([award(29, 'Some Award', [null])], DEFAULT_SCORING).size).toBe(0);
  });

  it('stacks several awards on one team', () => {
    const lines = awardLines(
      [award(0, 'Impact Award', ['frc1']), award(29, 'Industrial Design Award', ['frc1'])],
      DEFAULT_SCORING,
    );
    expect(lines.get('frc1')!.map((l) => l.points)).toEqual([10, 5]);
  });

  it('counts a team once per award even if listed twice', () => {
    const lines = awardLines([award(29, 'Some Award', ['frc1', 'frc1'])], DEFAULT_SCORING);
    expect(lines.get('frc1')).toHaveLength(1);
  });

  it('works with B-team keys', () => {
    const lines = awardLines([award(29, 'Some Award', ['frc341B'])], DEFAULT_SCORING);
    expect(lines.get('frc341B')![0].points).toBe(5);
  });

  it('handles null, empty, and a null recipient list', () => {
    expect(awardLines(null, DEFAULT_SCORING).size).toBe(0);
    expect(awardLines([], DEFAULT_SCORING).size).toBe(0);
    const broken = { name: 'x', award_type: 29, recipient_list: null } as unknown as Award;
    expect(awardLines([broken], DEFAULT_SCORING).size).toBe(0);
  });
});

describe('oprRanks', () => {
  it('ranks descending', () => {
    const ranks = oprRanks({ oprs: { frc1: 10.5, frc2: 80.2, frc3: 40 } });
    expect(ranks.get('frc2')).toBe(1);
    expect(ranks.get('frc3')).toBe(2);
    expect(ranks.get('frc1')).toBe(3);
  });

  it('uses competition ranking for ties: 1, 1, 3', () => {
    const ranks = oprRanks({ oprs: { frc1: 50, frc2: 50, frc3: 40 } });
    expect(ranks.get('frc1')).toBe(1);
    expect(ranks.get('frc2')).toBe(1);
    expect(ranks.get('frc3')).toBe(3);
  });

  it('treats floats within 1e-6 as equal', () => {
    const ranks = oprRanks({ oprs: { frc1: 50.0000001, frc2: 50.0000004, frc3: 49.99 } });
    expect(ranks.get('frc1')).toBe(1);
    expect(ranks.get('frc2')).toBe(1);
    expect(ranks.get('frc3')).toBe(3);
  });

  it('does not treat a 1e-5 gap as a tie', () => {
    const ranks = oprRanks({ oprs: { frc1: 50.00001, frc2: 50 } });
    expect(ranks.get('frc1')).toBe(1);
    expect(ranks.get('frc2')).toBe(2);
  });

  it('ignores non-numeric values and handles null', () => {
    const ranks = oprRanks({ oprs: { frc1: Number.NaN, frc2: 5 } });
    expect(ranks.has('frc1')).toBe(false);
    expect(ranks.get('frc2')).toBe(1);
    expect(oprRanks(null).size).toBe(0);
    expect(oprRanks({ oprs: null }).size).toBe(0);
  });
});

describe('oprLines (§3.4.6)', () => {
  const oprs = { oprs: { frc1: 90, frc2: 80, frc3: 70, frc4: 60 } };

  it('awards +6, +4, +2 to the top three after quals', () => {
    const lines = oprLines(oprs, DEFAULT_SCORING, true);
    expect(lines.get('frc1')).toEqual({ category: 'oprBonus', label: 'OPR rank #1', quantity: 1, points: 6 });
    expect(lines.get('frc2')!.points).toBe(4);
    expect(lines.get('frc3')!.points).toBe(2);
    expect(lines.get('frc4')!.points).toBe(0);
  });

  it('awards nothing before quals are complete', () => {
    expect(oprLines(oprs, DEFAULT_SCORING, false).size).toBe(0);
  });

  it('gives tied teams the better bonus and skips the next place', () => {
    const lines = oprLines({ oprs: { frc1: 90, frc2: 90, frc3: 70 } }, DEFAULT_SCORING, true);
    expect(lines.get('frc1')!.points).toBe(6);
    expect(lines.get('frc2')!.points).toBe(6);
    expect(lines.get('frc3')!.points).toBe(2);
  });

  it('awards nothing when the config has no OPR bonus or TBA has no OPRs', () => {
    expect([...oprLines(oprs, { ...DEFAULT_SCORING, oprBonus: [] }, true).values()].every((l) => l.points === 0)).toBe(true);
    expect(oprLines(null, DEFAULT_SCORING, true).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/scoring/bonus.test.ts`
Expected: FAIL, cannot resolve `@/lib/scoring/bonus`.

- [ ] **Step 3: Implement**

`lib/scoring/bonus.ts`:

```ts
import type { ScoringConfig } from '@/lib/scoring/config';
import type { Line } from '@/lib/scoring/types';
import type { Award, OprsResponse } from '@/lib/tba/types';

const OPR_EPSILON = 1e-6;

export function awardLines(awards: Award[] | null, config: ScoringConfig): Map<string, Line[]> {
  const out = new Map<string, Line[]>();
  const excluded = new Set(config.awards.excludedTypes);
  for (const award of awards ?? []) {
    if (excluded.has(award.award_type)) continue;
    const points = config.awards.byType[String(award.award_type)] ?? config.awards.default;
    const seen = new Set<string>();
    for (const recipient of award.recipient_list ?? []) {
      const team = recipient?.team_key;
      if (!team || seen.has(team)) continue;
      seen.add(team);
      const list = out.get(team) ?? [];
      list.push({ category: 'awards', label: award.name, points });
      out.set(team, list);
    }
  }
  return out;
}

/** Competition ranking by OPR, highest first. Ties share the better place: 1, 1, 3. */
export function oprRanks(oprs: OprsResponse | null): Map<string, number> {
  const entries = Object.entries(oprs?.oprs ?? {})
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const out = new Map<string, number>();
  let rank = 0;
  entries.forEach(([team, value], i) => {
    if (i === 0 || Math.abs(value - entries[i - 1][1]) >= OPR_EPSILON) rank = i + 1;
    out.set(team, rank);
  });
  return out;
}

export function oprLines(
  oprs: OprsResponse | null,
  config: ScoringConfig,
  qualsDone: boolean,
): Map<string, Line> {
  const out = new Map<string, Line>();
  if (!qualsDone) return out;
  for (const [team, rank] of oprRanks(oprs)) {
    out.set(team, {
      category: 'oprBonus',
      label: `OPR rank #${rank}`,
      quantity: rank,
      points: config.oprBonus[rank - 1] ?? 0,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/scoring/bonus.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/bonus.ts tests/scoring/bonus.test.ts
git commit -m "feat: awards and OPR bonus scoring"
```

---

### Task 8: `scoreEvent` (assemble the engine)

**Files:**
- Create: `lib/scoring/engine.ts`
- Test: `tests/scoring/engine.test.ts`

**Interfaces:**
- Consumes: `qualsComplete` (Task 4), `qualLines` (Task 5), `allianceLines`, `allianceMembers`, `playoffLines`, `eventResultLines` (Task 6), `awardLines`, `oprLines` (Task 7).
- Produces: `scoreEvent(data: EventData, config: ScoringConfig): EventScores` where `EventScores = { teams: Map<string, TeamScore>; qualsComplete: boolean; rpMethod: RpMethod }`. Lines appear in this fixed order: `qualRecord`, `rankingPoints`, `rank`, `alliance`, `playoffWins`, `eventResult`, `awards`, `oprBonus`. Zero-point lines are kept in the data.

- [ ] **Step 1: Write the failing test**

`tests/scoring/engine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { scoreEvent } from '@/lib/scoring/engine';
import type { EventData } from '@/lib/tba/types';
import { alliance, emptyEvent, match, rankRow, rankings } from '../helpers/builders';

const A0 = ['frc1', 'frc2', 'frc3'];
const A1 = ['frc4', 'frc5', 'frc6'];

function finishedEvent(): EventData {
  return {
    teams: [...A0, ...A1, 'frc7'].map((key) => ({ key, team_number: Number(key.slice(3)), nickname: key })),
    rankings: rankings([
      rankRow(1, 'frc1', [2, 0, 0], { extra_stats: [7] }),
      rankRow(2, 'frc4', [1, 1, 0], { extra_stats: [4] }),
      rankRow(17, 'frc7', [0, 2, 0], { extra_stats: [0] }),
    ]),
    matches: [
      match({ num: 1, red: A0, blue: A1, redScore: 50, blueScore: 10 }),
      match({ level: 'f', set: 1, num: 1, red: A0, blue: A1, redScore: 50, blueScore: 10 }),
      match({ level: 'f', set: 1, num: 2, red: A0, blue: A1, redScore: 50, blueScore: 10 }),
    ],
    alliances: [
      alliance(A0, { status: { level: 'f', status: 'won' } }),
      alliance(A1, { status: { level: 'f', status: 'eliminated' } }),
    ],
    awards: [{ name: 'Industrial Design Award', award_type: 29, recipient_list: [{ team_key: 'frc1', awardee: null }] }],
    oprs: { oprs: { frc1: 40, frc4: 30, frc2: 20, frc7: 1 } },
  };
}

describe('scoreEvent', () => {
  it('stacks every category for the winning captain', () => {
    const { teams, qualsComplete, rpMethod } = scoreEvent(finishedEvent(), DEFAULT_SCORING);
    expect(qualsComplete).toBe(true);
    expect(rpMethod).toBe('extra_stats');
    const t = teams.get('frc1')!;
    expect(t.lines).toEqual([
      { category: 'qualRecord', label: 'Qual record 2-0-0', points: 6 },
      { category: 'rankingPoints', label: 'Ranking points 7', quantity: 7, points: 7 },
      { category: 'rank', label: 'Final rank #1', quantity: 1, points: 10 },
      { category: 'alliance', label: 'Alliance captain', points: 8 },
      { category: 'playoffWins', label: 'Playoff wins ×2', quantity: 2, points: 8 },
      { category: 'eventResult', label: 'Event winner', points: 15 },
      { category: 'awards', label: 'Industrial Design Award', points: 5 },
      { category: 'oprBonus', label: 'OPR rank #1', quantity: 1, points: 6 },
    ]);
    expect(t.total).toBe(6 + 7 + 10 + 8 + 8 + 15 + 5 + 6);
  });

  it('scores a finalist and an undrafted-looking low team', () => {
    const { teams } = scoreEvent(finishedEvent(), DEFAULT_SCORING);
    // frc4: record 1-1-0 (3) + RP 4 + rank #2 (5) + captain (8) + finalist (8) + OPR #2 (4)
    expect(teams.get('frc4')!.total).toBe(3 + 4 + 5 + 8 + 8 + 4);
    // frc7: record 0-2-0 (0) + RP 0 + rank #17 (0) + OPR #4 (0)
    expect(teams.get('frc7')!.total).toBe(0);
  });

  it('returns a score for every team that appears in any input', () => {
    const data = emptyEvent();
    data.teams = [{ key: 'frc10', team_number: 10 }];
    data.rankings = rankings([rankRow(1, 'frc11', [1, 0, 0])]);
    data.matches = [match({ num: 1, red: ['frc12', 'frc13', 'frc14'], blue: ['frc15', 'frc16', 'frc17'] })];
    data.alliances = [alliance(['frc18', 'frc19', 'frc20'], { backup: { in: 'frc21', out: 'frc20' } })];
    data.awards = [{ name: 'x', award_type: 29, recipient_list: [{ team_key: 'frc22', awardee: null }] }];
    data.oprs = { oprs: { frc23: 5 } };
    const { teams } = scoreEvent(data, DEFAULT_SCORING);
    for (let n = 10; n <= 23; n++) expect(teams.has(`frc${n}`), `frc${n}`).toBe(true);
  });

  it('never throws on an event with no data, and returns zero teams', () => {
    const out = scoreEvent(emptyEvent(), DEFAULT_SCORING);
    expect(out.teams.size).toBe(0);
    expect(out.qualsComplete).toBe(false);
    expect(out.rpMethod).toBe('none');
  });

  it('gives listed teams a zero score before the event starts', () => {
    const data = emptyEvent();
    data.teams = [{ key: 'frc341B', team_number: 341 }];
    const { teams } = scoreEvent(data, DEFAULT_SCORING);
    expect(teams.get('frc341B')).toEqual({ teamKey: 'frc341B', total: 0, lines: [] });
  });

  it('holds back the OPR bonus and says "Current rank" while quals are running', () => {
    const data = finishedEvent();
    data.alliances = null;
    data.matches = [
      match({ num: 1, red: A0, blue: A1, redScore: 50, blueScore: 10 }),
      match({ num: 2, red: A0, blue: A1 }),
    ];
    const { teams, qualsComplete } = scoreEvent(data, DEFAULT_SCORING);
    expect(qualsComplete).toBe(false);
    const lines = teams.get('frc1')!.lines;
    expect(lines.some((l) => l.category === 'oprBonus')).toBe(false);
    expect(lines.find((l) => l.category === 'rank')!.label).toBe('Current rank #1');
  });

  it('uses the round config, not the defaults', () => {
    const config = { ...DEFAULT_SCORING, qualWin: 1, eventWinner: 100 };
    const { teams } = scoreEvent(finishedEvent(), config);
    const t = teams.get('frc1')!;
    expect(t.lines.find((l) => l.category === 'qualRecord')!.points).toBe(2);
    expect(t.lines.find((l) => l.category === 'eventResult')!.points).toBe(100);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/scoring/engine.test.ts`
Expected: FAIL, cannot resolve `@/lib/scoring/engine`.

- [ ] **Step 3: Implement**

`lib/scoring/engine.ts`:

```ts
import { awardLines, oprLines } from '@/lib/scoring/bonus';
import type { ScoringConfig } from '@/lib/scoring/config';
import { qualsComplete } from '@/lib/scoring/matches';
import { allianceLines, allianceMembers, eventResultLines, playoffLines } from '@/lib/scoring/playoffs';
import { qualLines } from '@/lib/scoring/quals';
import type { EventScores, Line, TeamScore } from '@/lib/scoring/types';
import type { EventData } from '@/lib/tba/types';

/** Pure function: TBA data + config in, a score for every team out. No I/O, never throws on missing data. */
export function scoreEvent(data: EventData, config: ScoringConfig): EventScores {
  const done = qualsComplete(data.matches, data.alliances);

  const quals = qualLines({ rankings: data.rankings, matches: data.matches }, config, done);
  const alliance = allianceLines(data.alliances, config);
  const wins = playoffLines(data.matches, config);
  const result = eventResultLines(data.alliances, data.matches, config);
  const awards = awardLines(data.awards, config);
  const opr = oprLines(data.oprs, config, done);

  const keys = new Set<string>();
  for (const t of data.teams ?? []) keys.add(t.key);
  for (const r of data.rankings?.rankings ?? []) keys.add(r.team_key);
  for (const m of data.matches ?? []) {
    for (const side of ['red', 'blue'] as const) {
      for (const k of m.alliances?.[side]?.team_keys ?? []) keys.add(k);
    }
  }
  for (const a of data.alliances ?? []) for (const k of allianceMembers(a)) keys.add(k);
  for (const k of awards.keys()) keys.add(k);
  for (const k of opr.keys()) keys.add(k);

  const teams = new Map<string, TeamScore>();
  for (const teamKey of keys) {
    const lines: Line[] = [...(quals.lines.get(teamKey) ?? [])];
    const one = (line: Line | undefined) => {
      if (line) lines.push(line);
    };
    one(alliance.get(teamKey));
    one(wins.get(teamKey));
    one(result.get(teamKey));
    lines.push(...(awards.get(teamKey) ?? []));
    one(opr.get(teamKey));
    teams.set(teamKey, { teamKey, total: lines.reduce((sum, l) => sum + l.points, 0), lines });
  }

  return { teams, qualsComplete: done, rpMethod: quals.rpMethod };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/scoring && npm run typecheck`
Expected: every scoring test passes; typecheck prints nothing.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/engine.ts tests/scoring/engine.test.ts
git commit -m "feat: scoreEvent assembles all scoring categories"
```

---

### Task 9: Snake draft, round scoring, season standings

**Files:**
- Create: `lib/scoring/round.ts`
- Test: `tests/scoring/round.test.ts`

**Interfaces:**
- Consumes: `TeamScore`, `Line`, `Pick`, `Adjustment`, `Player`, `PlayerRoundScore`, `SeasonRow` from `@/lib/scoring/types`.
- Produces:
  - `pickerFor(pickNumber: number, order: string[]): string` — throws `Error` on an empty order or a bad pick number
  - `rankByTotal<T extends { name: string; total: number }>(rows: T[]): (T & { rank: number })[]` — sorted descending, ties share a rank (1,1,3), alphabetical inside a tie
  - `roundPlayers(allPlayers: Player[], draftOrder: string[], adjustments: Adjustment[]): Player[]` — draft-order players first, then anyone who only has a player-targeted adjustment
  - `scoreRound(eventScores: Map<string, TeamScore>, picks: Pick[], adjustments: Adjustment[], players: Player[]): PlayerRoundScore[]`
  - `seasonStandings(players: Player[], rounds: PlayerRoundScore[][]): SeasonRow[]`

- [ ] **Step 1: Write the failing test**

`tests/scoring/round.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pickerFor, rankByTotal, roundPlayers, scoreRound, seasonStandings } from '@/lib/scoring/round';
import type { Adjustment, Pick, Player, TeamScore } from '@/lib/scoring/types';

const mom: Player = { id: 'p-mom', name: 'Mom' };
const dad: Player = { id: 'p-dad', name: 'Dad' };
const joey: Player = { id: 'p-joey', name: 'Joey' };
const gran: Player = { id: 'p-gran', name: 'Gran' };

function team(teamKey: string, total: number): TeamScore {
  return { teamKey, total, lines: total === 0 ? [] : [{ category: 'qualRecord', label: 'Qual record', points: total }] };
}

function scores(...teams: TeamScore[]): Map<string, TeamScore> {
  return new Map(teams.map((t) => [t.teamKey, t]));
}

function pick(pickNumber: number, player: Player, teamKey: string): Pick {
  return { pickNumber, playerId: player.id, teamKey };
}

function adj(a: Partial<Adjustment> & { points: number; reason: string }): Adjustment {
  return { id: `adj-${a.reason}`, playerId: null, teamKey: null, ...a };
}

describe('pickerFor (§3.2)', () => {
  const sequence = (order: string[], count: number) =>
    Array.from({ length: count }, (_, n) => pickerFor(n, order));

  it('P = 1', () => {
    expect(sequence(['a'], 3)).toEqual(['a', 'a', 'a']);
  });
  it('P = 2', () => {
    expect(sequence(['a', 'b'], 6)).toEqual(['a', 'b', 'b', 'a', 'a', 'b']);
  });
  it('P = 3', () => {
    expect(sequence(['a', 'b', 'c'], 9)).toEqual(['a', 'b', 'c', 'c', 'b', 'a', 'a', 'b', 'c']);
  });
  it('P = 5', () => {
    expect(sequence(['a', 'b', 'c', 'd', 'e'], 12)).toEqual([
      'a', 'b', 'c', 'd', 'e', 'e', 'd', 'c', 'b', 'a', 'a', 'b',
    ]);
  });
  it('throws on an empty order or a bad pick number', () => {
    expect(() => pickerFor(0, [])).toThrow();
    expect(() => pickerFor(-1, ['a'])).toThrow();
    expect(() => pickerFor(1.5, ['a'])).toThrow();
  });
});

describe('rankByTotal (§3.6)', () => {
  it('sorts descending and shares ranks on ties: 1, 1, 3', () => {
    const out = rankByTotal([
      { name: 'Mom', total: 50 },
      { name: 'Joey', total: 80 },
      { name: 'dad', total: 80 },
    ]);
    expect(out.map((r) => [r.name, r.rank])).toEqual([
      ['dad', 1],
      ['Joey', 1],
      ['Mom', 3],
    ]);
  });
  it('handles an empty list', () => {
    expect(rankByTotal([])).toEqual([]);
  });
});

describe('roundPlayers', () => {
  it('returns draft-order players in draft order', () => {
    expect(roundPlayers([mom, dad, joey], [joey.id, mom.id], [])).toEqual([joey, mom]);
  });
  // Review Focus 5
  it('adds a player who only has an adjustment', () => {
    const out = roundPlayers([mom, dad, joey], [joey.id], [adj({ playerId: dad.id, points: 5, reason: 'bet' })]);
    expect(out).toEqual([joey, dad]);
  });
  it('skips ids that are not league players', () => {
    expect(roundPlayers([mom], ['ghost', mom.id], [])).toEqual([mom]);
  });
});

describe('scoreRound', () => {
  it('sums each player\'s drafted teams, in pick order', () => {
    const out = scoreRound(
      scores(team('frc1', 40), team('frc2', 10), team('frc3', 25)),
      [pick(0, mom, 'frc1'), pick(1, dad, 'frc3'), pick(2, dad, 'frc2')],
      [],
      [mom, dad],
    );
    expect(out.map((p) => [p.name, p.total, p.rank])).toEqual([
      ['Mom', 40, 1],
      ['Dad', 35, 2],
    ]);
    expect(out[1].teams.map((t) => t.teamKey)).toEqual(['frc3', 'frc2']);
  });

  it('adds a team-targeted adjustment to the owning player, as a line on that team', () => {
    const out = scoreRound(
      scores(team('frc1', 40)),
      [pick(0, mom, 'frc1')],
      [adj({ teamKey: 'frc1', points: 5, reason: 'Industrial Design Award' })],
      [mom, dad],
    );
    const momRow = out.find((p) => p.playerId === mom.id)!;
    expect(momRow.total).toBe(45);
    expect(momRow.teams[0].total).toBe(45);
    expect(momRow.teams[0].lines.at(-1)).toEqual({
      category: 'adjustment',
      label: 'Adjustment: Industrial Design Award',
      points: 5,
    });
    expect(out.find((p) => p.playerId === dad.id)!.total).toBe(0);
  });

  it('does not mutate the event scores it was given', () => {
    const eventScores = scores(team('frc1', 40));
    scoreRound(eventScores, [pick(0, mom, 'frc1')], [adj({ teamKey: 'frc1', points: 5, reason: 'x' })], [mom]);
    expect(eventScores.get('frc1')!.total).toBe(40);
    expect(eventScores.get('frc1')!.lines).toHaveLength(1);
  });

  it('ignores a team-targeted adjustment on an undrafted team', () => {
    const out = scoreRound(
      scores(team('frc1', 40), team('frc9', 3)),
      [pick(0, mom, 'frc1')],
      [adj({ teamKey: 'frc9', points: 50, reason: 'nobody owns this' })],
      [mom],
    );
    expect(out[0].total).toBe(40);
  });

  it('adds player-targeted adjustments, including negative ones', () => {
    const out = scoreRound(
      scores(team('frc1', 40)),
      [pick(0, mom, 'frc1')],
      [adj({ playerId: mom.id, points: -10, reason: 'Late to draft' })],
      [mom],
    );
    expect(out[0].total).toBe(30);
    expect(out[0].adjustments).toEqual([
      { category: 'adjustment', label: 'Adjustment: Late to draft', points: -10 },
    ]);
  });

  // Review Focus 5
  it('scores an adjustment for a player who is not in the draft order', () => {
    const adjustments = [adj({ playerId: gran.id, points: 7, reason: 'Guessed the winner' })];
    const players = roundPlayers([mom, gran], [mom.id], adjustments);
    const out = scoreRound(scores(team('frc1', 40)), [pick(0, mom, 'frc1')], adjustments, players);
    expect(out.map((p) => [p.name, p.total])).toEqual([
      ['Mom', 40],
      ['Gran', 7],
    ]);
  });

  it('gives 0 to a participating player with no picks yet', () => {
    const out = scoreRound(scores(team('frc1', 40)), [pick(0, mom, 'frc1')], [], [mom, dad]);
    expect(out.find((p) => p.playerId === dad.id)).toMatchObject({ total: 0, teams: [], rank: 2 });
  });

  it('scores a drafted team with no event data as 0', () => {
    const out = scoreRound(new Map(), [pick(0, mom, 'frc9999')], [], [mom]);
    expect(out[0].teams).toEqual([{ teamKey: 'frc9999', total: 0, lines: [] }]);
    expect(out[0].total).toBe(0);
  });

  it('shares a rank on ties and orders the tie alphabetically', () => {
    const out = scoreRound(
      scores(team('frc1', 20), team('frc2', 20), team('frc3', 5)),
      [pick(0, mom, 'frc1'), pick(1, dad, 'frc2'), pick(2, joey, 'frc3')],
      [],
      [mom, dad, joey],
    );
    expect(out.map((p) => [p.name, p.rank])).toEqual([
      ['Dad', 1],
      ['Mom', 1],
      ['Joey', 3],
    ]);
  });
});

describe('seasonStandings', () => {
  it('sums rounds, with 0 for a round a player skipped', () => {
    const round1 = scoreRound(
      scores(team('frc1', 40), team('frc2', 10)),
      [pick(0, mom, 'frc1'), pick(1, dad, 'frc2')],
      [],
      [mom, dad],
    );
    const round2 = scoreRound(scores(team('frc3', 25)), [pick(0, dad, 'frc3')], [], [dad]);
    const out = seasonStandings([mom, dad, joey], [round1, round2]);
    expect(out).toEqual([
      { playerId: mom.id, name: 'Mom', total: 40, rank: 1, perRound: [40, 0] },
      { playerId: dad.id, name: 'Dad', total: 35, rank: 2, perRound: [10, 25] },
      { playerId: joey.id, name: 'Joey', total: 0, rank: 3, perRound: [0, 0] },
    ]);
  });

  it('works with no rounds', () => {
    expect(seasonStandings([mom], [])).toEqual([
      { playerId: mom.id, name: 'Mom', total: 0, rank: 1, perRound: [] },
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/scoring/round.test.ts`
Expected: FAIL, cannot resolve `@/lib/scoring/round`.

- [ ] **Step 3: Implement**

`lib/scoring/round.ts`:

```ts
import type {
  Adjustment,
  Line,
  Pick,
  Player,
  PlayerRoundScore,
  SeasonRow,
  TeamScore,
} from '@/lib/scoring/types';

/** Snake draft: 1-2-3, 3-2-1, 1-2-3, ... (§3.2). pickNumber is 0-indexed. */
export function pickerFor(pickNumber: number, order: string[]): string {
  const P = order.length;
  if (P === 0) throw new Error('Draft order is empty');
  if (!Number.isInteger(pickNumber) || pickNumber < 0) {
    throw new Error('Pick number must be a whole number, 0 or more');
  }
  const draftRound = Math.floor(pickNumber / P);
  const slot = pickNumber % P;
  return draftRound % 2 === 0 ? order[slot] : order[P - 1 - slot];
}

export function rankByTotal<T extends { name: string; total: number }>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
  );
  let rank = 0;
  return sorted.map((row, i) => {
    if (i === 0 || row.total !== sorted[i - 1].total) rank = i + 1;
    return { ...row, rank };
  });
}

export function roundPlayers(allPlayers: Player[], draftOrder: string[], adjustments: Adjustment[]): Player[] {
  const byId = new Map(allPlayers.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: Player[] = [];
  const add = (id: string | null) => {
    if (!id || seen.has(id)) return;
    const player = byId.get(id);
    if (!player) return;
    seen.add(id);
    out.push(player);
  };
  draftOrder.forEach(add);
  adjustments.forEach((a) => add(a.playerId));
  return out;
}

function adjustmentLine(a: Adjustment): Line {
  return { category: 'adjustment', label: `Adjustment: ${a.reason}`, points: a.points };
}

export function scoreRound(
  eventScores: Map<string, TeamScore>,
  picks: Pick[],
  adjustments: Adjustment[],
  players: Player[],
): PlayerRoundScore[] {
  const ordered = [...picks].sort((a, b) => a.pickNumber - b.pickNumber);

  const rows = players.map((player) => {
    const teams: TeamScore[] = ordered
      .filter((p) => p.playerId === player.id)
      .map((p) => {
        const base = eventScores.get(p.teamKey);
        const extra = adjustments.filter((a) => a.teamKey === p.teamKey).map(adjustmentLine);
        const lines = [...(base?.lines ?? []), ...extra];
        return { teamKey: p.teamKey, total: lines.reduce((sum, l) => sum + l.points, 0), lines };
      });
    const own = adjustments.filter((a) => a.playerId === player.id).map(adjustmentLine);
    const total =
      teams.reduce((sum, t) => sum + t.total, 0) + own.reduce((sum, l) => sum + l.points, 0);
    return { playerId: player.id, name: player.name, total, teams, adjustments: own };
  });

  return rankByTotal(rows);
}

export function seasonStandings(players: Player[], rounds: PlayerRoundScore[][]): SeasonRow[] {
  const rows = players.map((player) => {
    const perRound = rounds.map((round) => round.find((r) => r.playerId === player.id)?.total ?? 0);
    return {
      playerId: player.id,
      name: player.name,
      total: perRound.reduce((sum, n) => sum + n, 0),
      perRound,
    };
  });
  return rankByTotal(rows).map((r) => ({
    playerId: r.playerId,
    name: r.name,
    total: r.total,
    rank: r.rank,
    perRound: r.perRound,
  }));
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/scoring/round.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/round.ts tests/scoring/round.test.ts
git commit -m "feat: snake draft order, round scoring, season standings"
```

---

### Task 10: Round status and cache windows

**Files:**
- Create: `lib/rounds/status.ts`
- Test: `tests/rounds/status.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type RoundTiming = { startDate: string; endDate: string; timezone: string | null; finalizedAt: string | null }` (dates are `YYYY-MM-DD`)
  - `type RoundStatus = 'final' | 'setup' | 'drafting' | 'upcoming' | 'live' | 'awaiting_final'`
  - `STATUS_LABEL: Record<RoundStatus, string>`
  - `localDate(now: Date, timezone: string | null | undefined): string`
  - `addDays(date: string, days: number): string`
  - `eventPhase(round: RoundTiming, now: Date): 'before' | 'during' | 'after'`
  - `cacheWindowFor(round: RoundTiming, now: Date): number` (milliseconds)
  - `roundStatus(round: RoundTiming & { rosterSize: number; draftOrder: string[] }, pickCount: number, now: Date): RoundStatus`
  - `shouldNudgeFinalize(round: RoundTiming, now: Date): boolean`
  - `MINUTE_MS`, `DEFAULT_WINDOW_MS` (10 minutes, for paths not tied to a round)

- [ ] **Step 1: Write the failing test**

`tests/rounds/status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addDays,
  cacheWindowFor,
  eventPhase,
  localDate,
  roundStatus,
  shouldNudgeFinalize,
  STATUS_LABEL,
} from '@/lib/rounds/status';

// Ramp Riot 2026 is one day: Sat Oct 24, 2026. Eastern is UTC-4 (EDT) on these dates.
const timing = {
  startDate: '2026-10-24',
  endDate: '2026-10-24',
  timezone: 'America/New_York',
  finalizedAt: null,
};
const drafted = { ...timing, rosterSize: 2, draftOrder: ['a', 'b'] }; // 4 picks completes the draft

const MIN = 60_000;

describe('localDate', () => {
  it('uses the round timezone, not UTC', () => {
    expect(localDate(new Date('2026-10-26T03:30:00Z'), 'America/New_York')).toBe('2026-10-25');
    expect(localDate(new Date('2026-10-26T04:30:00Z'), 'America/New_York')).toBe('2026-10-26');
  });
  // Review Focus 4
  it('falls back to Eastern for a missing or unknown timezone', () => {
    const now = new Date('2026-10-26T03:30:00Z');
    expect(localDate(now, null)).toBe('2026-10-25');
    expect(localDate(now, '')).toBe('2026-10-25');
    expect(localDate(now, 'Mars/Olympus_Mons')).toBe('2026-10-25');
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-10-24', 0)).toBe('2026-10-24');
  });
});

describe('eventPhase', () => {
  it('is "before" until the day before the event', () => {
    expect(eventPhase(timing, new Date('2026-10-23T03:30:00Z'))).toBe('before'); // Oct 22, 11:30 pm ET
  });
  it('is "during" from start - 1 day through end + 1 day', () => {
    expect(eventPhase(timing, new Date('2026-10-23T04:30:00Z'))).toBe('during'); // Oct 23, 12:30 am ET
    expect(eventPhase(timing, new Date('2026-10-24T18:00:00Z'))).toBe('during');
    expect(eventPhase(timing, new Date('2026-10-26T03:30:00Z'))).toBe('during'); // Oct 25, 11:30 pm ET
  });
  it('is "after" once end + 1 day has passed locally', () => {
    expect(eventPhase(timing, new Date('2026-10-26T04:30:00Z'))).toBe('after'); // Oct 26, 12:30 am ET
  });
});

describe('cacheWindowFor (§7.3)', () => {
  it('is 60 s during the event window', () => {
    expect(cacheWindowFor(timing, new Date('2026-10-24T18:00:00Z'))).toBe(1 * MIN);
  });
  it('is 10 min before and after', () => {
    expect(cacheWindowFor(timing, new Date('2026-10-01T12:00:00Z'))).toBe(10 * MIN);
    expect(cacheWindowFor(timing, new Date('2026-11-05T12:00:00Z'))).toBe(10 * MIN);
  });
  it('is 24 h once finalized, even on event day', () => {
    const final = { ...timing, finalizedAt: '2026-10-24T22:00:00Z' };
    expect(cacheWindowFor(final, new Date('2026-10-24T23:00:00Z'))).toBe(24 * 60 * MIN);
  });
  it('does not throw on a bad timezone', () => {
    expect(cacheWindowFor({ ...timing, timezone: 'Nope/Nope' }, new Date('2026-10-24T18:00:00Z'))).toBe(1 * MIN);
  });
});

describe('roundStatus (§7.8)', () => {
  const eventDay = new Date('2026-10-24T18:00:00Z');

  it('is Final whenever finalized_at is set, regardless of picks or dates', () => {
    const final = { ...drafted, finalizedAt: '2026-10-25T01:00:00Z' };
    expect(roundStatus(final, 0, eventDay)).toBe('final');
    expect(roundStatus(final, 4, eventDay)).toBe('final');
  });
  it('is Setup with no picks', () => {
    expect(roundStatus(drafted, 0, eventDay)).toBe('setup');
    expect(roundStatus({ ...drafted, draftOrder: [] }, 0, eventDay)).toBe('setup');
  });
  it('is Drafting with some but not all picks', () => {
    expect(roundStatus(drafted, 1, eventDay)).toBe('drafting');
    expect(roundStatus(drafted, 3, eventDay)).toBe('drafting');
  });
  it('is Upcoming, Live, then Awaiting final once the draft is complete', () => {
    expect(roundStatus(drafted, 4, new Date('2026-10-20T12:00:00Z'))).toBe('upcoming');
    expect(roundStatus(drafted, 4, new Date('2026-10-23T12:00:00Z'))).toBe('live');
    expect(roundStatus(drafted, 4, eventDay)).toBe('live');
    expect(roundStatus(drafted, 4, new Date('2026-10-26T03:30:00Z'))).toBe('live');
    expect(roundStatus(drafted, 4, new Date('2026-10-26T04:30:00Z'))).toBe('awaiting_final');
  });
  it('never becomes Final from dates alone', () => {
    expect(roundStatus(drafted, 4, new Date('2027-06-01T12:00:00Z'))).toBe('awaiting_final');
  });
});

describe('shouldNudgeFinalize (§5.5)', () => {
  it('nudges only after the event window, and only if not final', () => {
    expect(shouldNudgeFinalize(timing, new Date('2026-10-24T18:00:00Z'))).toBe(false);
    expect(shouldNudgeFinalize(timing, new Date('2026-10-26T04:30:00Z'))).toBe(true);
    expect(shouldNudgeFinalize({ ...timing, finalizedAt: '2026-10-26T00:00:00Z' }, new Date('2026-10-27T12:00:00Z'))).toBe(false);
  });
});

describe('STATUS_LABEL', () => {
  it('has the spec badge text', () => {
    expect(STATUS_LABEL).toEqual({
      setup: 'Setup',
      drafting: 'Drafting',
      upcoming: 'Upcoming',
      live: 'Live',
      awaiting_final: 'Awaiting final',
      final: 'Final',
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/rounds/status.test.ts`
Expected: FAIL, cannot resolve `@/lib/rounds/status`.

- [ ] **Step 3: Implement**

`lib/rounds/status.ts`:

```ts
export type RoundTiming = {
  startDate: string; // YYYY-MM-DD
  endDate: string;
  timezone: string | null;
  finalizedAt: string | null;
};

export type RoundStatus = 'final' | 'setup' | 'drafting' | 'upcoming' | 'live' | 'awaiting_final';

export const STATUS_LABEL: Record<RoundStatus, string> = {
  setup: 'Setup',
  drafting: 'Drafting',
  upcoming: 'Upcoming',
  live: 'Live',
  awaiting_final: 'Awaiting final',
  final: 'Final',
};

export const MINUTE_MS = 60_000;
export const DEFAULT_WINDOW_MS = 10 * MINUTE_MS;

const FALLBACK_TIMEZONE = 'America/New_York';

function formatIn(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today's date (YYYY-MM-DD) where the event is. Unknown timezones fall back to Eastern. */
export function localDate(now: Date, timezone: string | null | undefined): string {
  try {
    return formatIn(now, timezone || FALLBACK_TIMEZONE);
  } catch {
    return formatIn(now, FALLBACK_TIMEZONE);
  }
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD strings compare correctly as plain strings. */
export function eventPhase(round: RoundTiming, now: Date): 'before' | 'during' | 'after' {
  const today = localDate(now, round.timezone);
  if (today < addDays(round.startDate, -1)) return 'before';
  if (today > addDays(round.endDate, 1)) return 'after';
  return 'during';
}

export function cacheWindowFor(round: RoundTiming, now: Date): number {
  if (round.finalizedAt) return 24 * 60 * MINUTE_MS;
  return eventPhase(round, now) === 'during' ? MINUTE_MS : 10 * MINUTE_MS;
}

export function roundStatus(
  round: RoundTiming & { rosterSize: number; draftOrder: string[] },
  pickCount: number,
  now: Date,
): RoundStatus {
  if (round.finalizedAt) return 'final';
  if (pickCount <= 0) return 'setup';
  if (pickCount < round.draftOrder.length * round.rosterSize) return 'drafting';
  const phase = eventPhase(round, now);
  if (phase === 'before') return 'upcoming';
  if (phase === 'during') return 'live';
  return 'awaiting_final';
}

export function shouldNudgeFinalize(round: RoundTiming, now: Date): boolean {
  return !round.finalizedAt && eventPhase(round, now) === 'after';
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/rounds/status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rounds/status.ts tests/rounds/status.test.ts
git commit -m "feat: round status and cache windows"
```

---

### Task 11: Capture the `2025parr` fixture and pin the replay

This is the only task that needs the internet and Joey's TBA key. It proves the engine against a real event.

**Files:**
- Create: `scripts/capture-fixture.ts`
- Create: `tests/helpers/fixture.ts`
- Create: `tests/fixtures/2025parr/{event,teams,matches,rankings,alliances,awards,oprs}.json` (generated)
- Test: `tests/scoring/fixture-2025parr.test.ts`

**Interfaces:**
- Consumes: `scoreEvent` (Task 8), `finalsResult`, `allianceMembers` (Task 6), `hasResult`, `winnerOf`, `creditedTeams` (Task 4), `DEFAULT_SCORING` (Task 2).
- Produces: `loadFixture(eventKey: string): EventData` and `loadFixtureEvent(eventKey: string): TbaEvent` from `tests/helpers/fixture.ts`. The CLI `npx tsx --env-file=.env.local scripts/capture-fixture.ts <eventKey>`.

- [ ] **Step 1: (Joey) Get a TBA key**

1. Sign in at `https://www.thebluealliance.com/account`.
2. Under **Read API Keys**, add a key with the description `frc-fantasy`.
3. Copy `.env.example` to `.env.local` and paste the key after `TBA_API_KEY=`.

Check it is ignored by git:

```bash
git check-ignore -v .env.local
```

Expected: a line showing `.gitignore` matched `.env.local`. If it prints nothing, stop and fix `.gitignore` before going on.

- [ ] **Step 2: Write the capture script**

`scripts/capture-fixture.ts`:

```ts
// Downloads every TBA endpoint the app uses for one event into tests/fixtures/<eventKey>/.
// Usage: npx tsx --env-file=.env.local scripts/capture-fixture.ts 2025parr
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://www.thebluealliance.com/api/v3';

const FILES: Record<string, string> = {
  event: '',
  teams: '/teams/simple',
  matches: '/matches/simple',
  rankings: '/rankings',
  alliances: '/alliances',
  awards: '/awards',
  oprs: '/oprs',
};

async function main() {
  const eventKey = (process.argv[2] ?? '').trim().toLowerCase();
  if (!/^[0-9]{4}[a-z0-9]+$/.test(eventKey)) {
    throw new Error('Usage: capture-fixture.ts <eventKey>   e.g. 2025parr');
  }
  const apiKey = process.env.TBA_API_KEY;
  if (!apiKey) throw new Error('TBA_API_KEY is not set. Put it in .env.local.');

  const dir = path.join(process.cwd(), 'tests', 'fixtures', eventKey);
  await mkdir(dir, { recursive: true });

  for (const [name, suffix] of Object.entries(FILES)) {
    const url = `${BASE}/event/${eventKey}${suffix}`;
    const res = await fetch(url, { headers: { 'X-TBA-Auth-Key': apiKey }, cache: 'no-store' });
    let body: unknown = null;
    if (res.status === 200) body = await res.json();
    else if (res.status !== 404) throw new Error(`${url} returned HTTP ${res.status}`);
    await writeFile(path.join(dir, `${name}.json`), `${JSON.stringify(body, null, 2)}\n`);
    const size = Array.isArray(body) ? `${body.length} items` : body === null ? 'no data' : 'object';
    console.log(`${name}.json  (${size})`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 3: Run the capture**

```bash
npx tsx --env-file=.env.local scripts/capture-fixture.ts 2025parr
```

Expected output, one line per file, including `teams.json  (34 items)`. `awards.json` should report `0 items` or `no data`. If `teams.json` is not 34 items, stop and tell Joey: the spec's known facts about this event no longer match TBA.

- [ ] **Step 4: Write the fixture loader**

`tests/helpers/fixture.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { EventData, TbaEvent } from '@/lib/tba/types';

function read<T>(eventKey: string, name: string): T {
  const file = path.join(process.cwd(), 'tests', 'fixtures', eventKey, `${name}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export function loadFixture(eventKey: string): EventData {
  return {
    teams: read(eventKey, 'teams'),
    matches: read(eventKey, 'matches'),
    rankings: read(eventKey, 'rankings'),
    alliances: read(eventKey, 'alliances'),
    awards: read(eventKey, 'awards'),
    oprs: read(eventKey, 'oprs'),
  };
}

export function loadFixtureEvent(eventKey: string): TbaEvent {
  return read<TbaEvent>(eventKey, 'event');
}
```

- [ ] **Step 5: Write the replay test**

`tests/scoring/fixture-2025parr.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { scoreEvent } from '@/lib/scoring/engine';
import { creditedTeams, hasResult, winnerOf } from '@/lib/scoring/matches';
import { allianceMembers, finalsResult } from '@/lib/scoring/playoffs';
import type { CategoryId } from '@/lib/scoring/types';
import { loadFixture, loadFixtureEvent } from '../helpers/fixture';

const data = loadFixture('2025parr');
const scored = scoreEvent(data, DEFAULT_SCORING);

function pointsFor(teamKey: string, category: CategoryId): number {
  return (scored.teams.get(teamKey)?.lines ?? [])
    .filter((l) => l.category === category)
    .reduce((sum, l) => sum + l.points, 0);
}

describe('Ramp Riot 2025 replay: known facts', () => {
  it('is the right event', () => {
    expect(loadFixtureEvent('2025parr').key).toBe('2025parr');
  });

  it('has 34 teams in the pool, all with valid keys', () => {
    expect(data.teams).toHaveLength(34);
    for (const t of data.teams!) expect(t.key).toMatch(/^frc[1-9][0-9]{0,4}[A-Z]?$/);
  });

  it('scores every team in the pool', () => {
    for (const t of data.teams!) expect(scored.teams.has(t.key), t.key).toBe(true);
  });

  it('reads ranking points from extra_stats (branch 1)', () => {
    expect(scored.rpMethod).toBe('extra_stats');
  });

  it('knows quals are complete', () => {
    expect(scored.qualsComplete).toBe(true);
  });

  it('finds winner = Alliance 3 and finalist = Alliance 4 from alliance status', () => {
    expect(finalsResult(data.alliances, data.matches)).toEqual({ winner: 2, finalist: 3 });
  });

  it('finds the same winner and finalist from finals matches alone', () => {
    const stripped = data.alliances!.map((a) => ({ ...a, status: null }));
    expect(finalsResult(stripped, data.matches)).toEqual({ winner: 2, finalist: 3 });
  });

  it('gives every Alliance 3 member winner points and every Alliance 4 member finalist points', () => {
    for (const k of allianceMembers(data.alliances![2])) expect(pointsFor(k, 'eventResult'), k).toBe(15);
    for (const k of allianceMembers(data.alliances![3])) expect(pointsFor(k, 'eventResult'), k).toBe(8);
  });

  it("scores Alliance 2's fourth robot as a third pick", () => {
    const picks = data.alliances![1].picks;
    expect(picks).toHaveLength(4);
    const line = scored.teams.get(picks[3])!.lines.find((l) => l.category === 'alliance');
    expect(line).toEqual({ category: 'alliance', label: 'Alliance third pick', points: 2 });
  });

  it('awards no playoff-win points for the 156-156 tie', () => {
    const playoffs = data.matches!.filter((m) => m.comp_level !== 'qm' && hasResult(m));
    const tied = playoffs.filter(
      (m) => m.alliances!.red.score === 156 && m.alliances!.blue.score === 156,
    );
    expect(tied).toHaveLength(1);
    expect(winnerOf(tied[0])).toBeNull();

    // Total win credits handed out must equal the credits from decided matches only.
    const expectedCredits = playoffs.reduce((sum, m) => {
      const w = winnerOf(m);
      return sum + (w ? creditedTeams(m, w).length : 0);
    }, 0);
    const actualCredits = [...scored.teams.values()].reduce(
      (sum, t) => sum + (t.lines.find((l) => l.category === 'playoffWins')?.quantity ?? 0),
      0,
    );
    expect(actualCredits).toBe(expectedCredits);
  });

  it('has no award points, because TBA has no awards for this event', () => {
    for (const t of scored.teams.values()) {
      expect(t.lines.some((l) => l.category === 'awards'), t.teamKey).toBe(false);
    }
  });

  it('awards the OPR bonus to exactly the top three', () => {
    const bonuses = [...scored.teams.values()]
      .map((t) => t.lines.find((l) => l.category === 'oprBonus')?.points ?? 0)
      .filter((p) => p > 0)
      .sort((a, b) => b - a);
    expect(bonuses).toEqual([6, 4, 2]);
  });

  it('makes every total equal the sum of its lines, with whole numbers only', () => {
    for (const t of scored.teams.values()) {
      expect(t.total, t.teamKey).toBe(t.lines.reduce((sum, l) => sum + l.points, 0));
      expect(Number.isInteger(t.total), t.teamKey).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Hand-verified breakdowns (spec §10.2).
//
// These numbers come from a HUMAN reading thebluealliance.com/event/2025parr,
// not from running the engine. Step 6 of Task 11 explains how to fill them in.
// ---------------------------------------------------------------------------
type HandVerified = {
  why: string;
  record: [wins: number, losses: number, ties: number];
  rankingPoints: number;
  rank: number;
  alliancePoints: number; // captain 8, first pick 6, second pick 3, third pick 2, backup 2, none 0
  playoffWins: number; // matches won, not points
  eventResultPoints: number; // winner 15, finalist 8, neither 0
  oprBonusPoints: number; // 6, 4, 2, or 0
  total: number;
};

const HAND_VERIFIED: Record<string, HandVerified> = {};

describe('Ramp Riot 2025 replay: hand-verified teams', () => {
  it('has three hand-verified teams', () => {
    expect(Object.keys(HAND_VERIFIED)).toHaveLength(3);
  });

  it('matches every hand-verified number', () => {
    for (const [teamKey, want] of Object.entries(HAND_VERIFIED)) {
      const [w, l, t] = want.record;
      const lines = scored.teams.get(teamKey)!.lines;
      expect(lines.find((x) => x.category === 'qualRecord')?.label, teamKey).toBe(`Qual record ${w}-${l}-${t}`);
      expect(pointsFor(teamKey, 'qualRecord'), teamKey).toBe(w * 3 + t * 1);
      expect(pointsFor(teamKey, 'rankingPoints'), teamKey).toBe(want.rankingPoints);
      expect(lines.find((x) => x.category === 'rank')?.quantity, teamKey).toBe(want.rank);
      expect(pointsFor(teamKey, 'alliance'), teamKey).toBe(want.alliancePoints);
      expect(pointsFor(teamKey, 'playoffWins'), teamKey).toBe(want.playoffWins * 4);
      expect(pointsFor(teamKey, 'eventResult'), teamKey).toBe(want.eventResultPoints);
      expect(pointsFor(teamKey, 'oprBonus'), teamKey).toBe(want.oprBonusPoints);
      expect(scored.teams.get(teamKey)!.total, teamKey).toBe(want.total);
    }
  });
});
```

- [ ] **Step 6: Run it: the known-facts tests pass, one hand-verified test fails**

Run: `npx vitest run tests/scoring/fixture-2025parr.test.ts`
Expected: every test under "known facts" PASSES. Exactly one test FAILS: `has three hand-verified teams` (expected length 3, got 0).

If a **known-facts** test fails, do not edit the test to make it pass. Either the engine has a bug (fix the engine and add a synthetic test for it in the matching `tests/scoring/*.test.ts`), or TBA's data differs from what the spec recorded (stop and tell Joey, quoting the failing assertion).

- [ ] **Step 7: (Joey, with the agent's help) Fill in `HAND_VERIFIED`**

Pick the three teams the spec asks for. Find their keys by reading the fixture files, not the engine:

| Which team | How to find it |
|---|---|
| The event winner's captain | `alliances.json`, third alliance (index 2), first entry of `picks` |
| A mid-ranked team | `rankings.json`, the row with `"rank": 17` |
| An unpicked low-ranked team | `rankings.json`, the highest `rank` number whose `team_key` is in no alliance's `picks` |

For each team, open `https://www.thebluealliance.com/event/2025parr` in a browser and read the numbers off the site:

| Field | Where on TBA |
|---|---|
| `record` | **Rankings** tab, "Record (W-L-T)" column |
| `rankingPoints` | **Rankings** tab, "Total Ranking Points" column |
| `rank` | **Rankings** tab, "Rank" column |
| `alliancePoints` | **Alliances** table: captain 8, first pick 6, second pick 3, third pick 2, not listed 0 |
| `playoffWins` | **Results** tab, playoff section: count the matches this team played in **and won**. Do not count the 156-156 tie. |
| `eventResultPoints` | 15 if on Alliance 3, 8 if on Alliance 4, otherwise 0 |
| `oprBonusPoints` | **Insights/OPR** tab sorted by OPR: 6 for the highest, 4 for second, 2 for third, otherwise 0 |
| `total` | Add it up by hand: `wins × 3 + ties × 1 + rankingPoints + rank tier + alliancePoints + playoffWins × 4 + eventResultPoints + oprBonusPoints`. Rank tier: #1 = 10, #2–8 = 5, #9–16 = 2, #17+ = 0. |

Replace `const HAND_VERIFIED: Record<string, HandVerified> = {};` with the three entries, shaped like this (the key is the team key; `why` says which of the three roles it fills):

```ts
const HAND_VERIFIED: Record<string, HandVerified> = {
  frcNNNN: {
    why: 'event winner captain (Alliance 3)',
    record: [W, L, T],
    rankingPoints: N,
    rank: N,
    alliancePoints: 8,
    playoffWins: N,
    eventResultPoints: 15,
    oprBonusPoints: N,
    total: N,
  },
  // ...the rank-17 team, then the unpicked low-ranked team, in the same shape
};
```

Every `N`, `W`, `L`, `T`, and `frcNNNN` above is replaced by a real value read from TBA. The file must not contain the letter placeholders when committed.

- [ ] **Step 8: Run it and watch it pass**

Run: `npx vitest run tests/scoring/fixture-2025parr.test.ts`
Expected: PASS, all tests.

If a hand-verified number disagrees with the engine, work out which is right before changing anything. Re-read the number on TBA first. If the site and the engine truly disagree, the engine is wrong: fix it and add a synthetic test.

- [ ] **Step 9: Run the whole suite and commit**

```bash
npm test && npm run typecheck
git add scripts/capture-fixture.ts tests/helpers/fixture.ts tests/fixtures/2025parr tests/scoring/fixture-2025parr.test.ts
git status --short
```

Expected: `git status` shows no `.env.local`. Then:

```bash
git commit -m "test: capture 2025parr fixture and pin the replay"
```

**Part 1 is done when:** `npm test` is green, the fixture is committed, and `HAND_VERIFIED` has three real teams. Go to Part 2.
