# Auto-finalize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rounds become Final on their own after their event (finals decided the day after, or a 3-day backstop), via the daily cron; reopening a round turns that off for the round.

**Architecture:** One new column (`rounds.auto_finalize`), one pure decision function (`lib/rounds/autoFinal.ts`), one new daily job (`lib/cron/autoFinalize.ts`) that reads candidates from the DB and, for TBA rounds, the cached TBA alliances + matches, then writes `finalized_at`. Reopen sets the column false. Copy changes in round admin step 4 and the status label.

**Tech Stack:** Next.js 16, TypeScript, Supabase Postgres, Vitest (node env, `tests/**/*.test.ts`), in-memory repo for tests (`tests/helpers/memoryRepo.ts`).

**Spec:** `docs/superpowers/specs/2026-10-02-auto-finalize-design.md` — read it before each task.

## Global Constraints

- `BACKSTOP_DAYS = 3`. Finals check only for `kind === 'tba'`, only when `today > endDate`. `today = localDate(now, round.timezone)` (`lib/rounds/status.ts`).
- Never finalize a round whose draft isn't complete (`picks >= draftOrder.length * rosterSize` and that total > 0), that is already final, or whose `autoFinalize` is false.
- Finals decided ⇔ `finalsResult(alliances, matches).winner !== null` (`lib/scoring/playoffs.ts`). No new scoring logic.
- TBA reads go through the existing cached client `getTba(path, { windowMs })` (`lib/tba/client.ts`) using `eventPaths(eventKey)` (`lib/tba/event.ts`) and `cacheWindowFor(round, now)`; never call TBA directly.
- Migration is additive and re-runnable: `alter table rounds add column if not exists auto_finalize boolean not null default true;`
- Copy: status label `awaiting_final` → "Results pending"; step 4 texts exactly as spec §7.
- Before every commit: `npx vitest run` green and `npx tsc --noEmit` clean. Path has a space — quote it. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A cron run where TBA (or `tba_cache`) throws for one round** must still finalize the other eligible rounds and report an error count — test in Task 3.
2. **A round in a far-west timezone at 11:30 pm local on `end_date`** must not be treated as "the day after" — test in Task 2.
3. **A full-season league's round** must finalize only via the backstop (never the finals check, even though season rounds have no `eventKey`) — tests in Tasks 2 and 3.
4. **A commissioner who reopens, then the 6 am job runs** — the round must stay open — test in Task 3 (job skips `autoFinalize: false`) and Task 4 (PATCH sets it).
5. **A database without migration 0006 applied** — `db-smoke` must stop with a clear "apply 0006" message — Task 1.

---

### Task 1: Migration 0006 + data layer

**Files:**
- Create: `supabase/migrations/0006_auto_finalize.sql`, `tests/db/autoFinalizeRepo.test.ts`
- Modify: `lib/db/types.ts` (RoundRow), `lib/db/repo.ts` (RoundPatch + new method), `lib/db/supabaseRepo.ts` (toRound map, updateRound map, new method), `tests/helpers/memoryRepo.ts` (default + new method + updateRound), `lib/api/types.ts` (`AdminRoundDetail.round.autoFinalize`), `lib/rounds/detail.ts` (pass it through), `scripts/db-smoke.ts` (require 0006)

**Interfaces:**
- Produces:
  - `RoundRow.autoFinalize: boolean`
  - `RoundPatch.autoFinalize?: boolean`
  - `Repo.listAutoFinalizeCandidates(): Promise<RoundRow[]>` — rounds with `finalizedAt === null && autoFinalize === true`, any league, any kind.
  - `AdminRoundDetail['round'].autoFinalize: boolean`

- [ ] **Step 1: Write the migration** `supabase/migrations/0006_auto_finalize.sql`:

```sql
-- 0006_auto_finalize.sql — rounds finalize on their own after the event (spec 2026-10-02 §3).
-- Additive and safe to re-run. Reopening a round sets auto_finalize = false for that round.
alter table rounds
  add column if not exists auto_finalize boolean not null default true;
```

- [ ] **Step 2: Write the failing test** `tests/db/autoFinalizeRepo.test.ts`. Look at an existing test under `tests/db/` (or `tests/api/`) for how `createMemoryRepo` and the builders seed a league + round, and write a local `seedRound(repo, eventKey = '2025parr')` helper the same way. Then:

```ts
import { describe, expect, it } from 'vitest';
import { createMemoryRepo } from '../helpers/memoryRepo';

describe('auto-finalize data', () => {
  it('new rounds default to autoFinalize true', async () => {
    const repo = createMemoryRepo();
    const round = await seedRound(repo);
    expect(round.autoFinalize).toBe(true);
  });
  it('updateRound can turn autoFinalize off and back on', async () => {
    const repo = createMemoryRepo();
    const round = await seedRound(repo);
    expect((await repo.updateRound(round.id, { autoFinalize: false })).autoFinalize).toBe(false);
    expect((await repo.updateRound(round.id, { autoFinalize: true })).autoFinalize).toBe(true);
  });
  it('lists only unfinalized rounds with auto-finalize on', async () => {
    const repo = createMemoryRepo();
    const open = await seedRound(repo, '2025parr');
    const final = await seedRound(repo, '2025pahat');
    const reopened = await seedRound(repo, '2025pawas');
    await repo.updateRound(final.id, { finalizedAt: '2025-10-30T10:00:00.000Z' });
    await repo.updateRound(reopened.id, { autoFinalize: false });
    expect((await repo.listAutoFinalizeCandidates()).map((r) => r.id)).toEqual([open.id]);
  });
});
```

- [ ] **Step 3: Run** `npx vitest run tests/db/autoFinalizeRepo.test.ts` → FAIL (`autoFinalize` undefined / method missing).

- [ ] **Step 4: Implement.**
  - `lib/db/types.ts` RoundRow: add after `autoAdded`:
    ```ts
    /** Spec 2026-10-02: the daily job may finalize this round. Reopening turns it off. */
    autoFinalize: boolean;
    ```
  - `lib/db/repo.ts`: `RoundPatch` gets `autoFinalize?: boolean;`; the `Repo` type gets, next to `listOpenSeasonRounds`:
    ```ts
    /** Not final and auto-finalize on, across all leagues (spec 2026-10-02 §5). */
    listAutoFinalizeCandidates(): Promise<RoundRow[]>;
    ```
  - `lib/db/supabaseRepo.ts`: in `toRound` add `autoFinalize: r.auto_finalize ?? true,`; in `updateRound`'s `defined({...})` add `auto_finalize: patch.autoFinalize,`; next to `listOpenSeasonRounds` add:
    ```ts
    async listAutoFinalizeCandidates() {
      const rows = await run(db.from('rounds').select().is('finalized_at', null).eq('auto_finalize', true));
      return rows.map(toRound);
    },
    ```
    (If a generated/declared row type lacks `auto_finalize`, extend it where the other round columns are declared.)
  - `tests/helpers/memoryRepo.ts`: in `createRound` add `autoFinalize: true,`; make `updateRound` apply `autoFinalize` when defined (same way it applies `finalizedAt`); next to `listOpenSeasonRounds` add:
    ```ts
    async listAutoFinalizeCandidates() {
      return copy(rounds.filter((r) => r.finalizedAt === null && r.autoFinalize));
    },
    ```
  - `lib/api/types.ts`: `AdminRoundDetail['round']` gets `autoFinalize: boolean;`; `lib/rounds/detail.ts` adds `autoFinalize: round.autoFinalize,`.
  - Every other place that builds a `RoundRow` literal (grep `autoAdded:` in `lib`, `tests`, `scripts`, `e2e`) gets `autoFinalize: true`.
  - `scripts/db-smoke.ts`: add `require0006()` modeled exactly on `require0005()`: probe `db.from('rounds').select('auto_finalize').limit(1)`; on error print `STOP: migration 0006_auto_finalize.sql is not applied:` + the message + `Paste supabase/migrations/0006_auto_finalize.sql into the Supabase SQL Editor, run it, then rerun db-smoke.` and `process.exit(1)`; on success print `ok    0006 auto_finalize column exists`. Call it right after `require0005()`. In the round checks add `check('round auto-finalize defaults on', round.autoFinalize === true);`.

- [ ] **Step 5: Run** `npx vitest run && npx tsc --noEmit` → green.
- [ ] **Step 6: Commit** — `feat: auto_finalize column and repo support (migration 0006)`.

### Task 2: The decision rule

**Files:**
- Create: `lib/rounds/autoFinal.ts`, `tests/rounds/autoFinal.test.ts`

**Interfaces:**
- Consumes: `localDate`, `addDays` (`lib/rounds/status.ts`), `RoundKind` (`lib/db/types.ts`).
- Produces:
  ```ts
  export const BACKSTOP_DAYS = 3;
  export type AutoFinalInput = { kind: RoundKind; endDate: string; timezone: string | null; finalizedAt: string | null; autoFinalize: boolean; draftComplete: boolean };
  export type AutoFinalDecision = 'finalize' | 'needs-finals-check' | 'wait';
  export function autoFinalDecision(r: AutoFinalInput, now: Date): AutoFinalDecision;
  export function draftComplete(round: { draftOrder: string[]; rosterSize: number }, pickCount: number): boolean;
  ```

- [ ] **Step 1: Write the failing test** `tests/rounds/autoFinal.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { autoFinalDecision, BACKSTOP_DAYS, draftComplete, type AutoFinalInput } from '@/lib/rounds/autoFinal';

const base: AutoFinalInput = {
  kind: 'tba', endDate: '2026-10-24', timezone: 'America/New_York',
  finalizedAt: null, autoFinalize: true, draftComplete: true,
};
// 10:00 UTC = 6 am Eastern, when the daily cron runs.
const at = (ymd: string) => new Date(`${ymd}T10:00:00Z`);

describe('draftComplete', () => {
  it('needs every pick made and at least one pick slot', () => {
    expect(draftComplete({ draftOrder: ['a', 'b'], rosterSize: 2 }, 4)).toBe(true);
    expect(draftComplete({ draftOrder: ['a', 'b'], rosterSize: 2 }, 3)).toBe(false);
    expect(draftComplete({ draftOrder: [], rosterSize: 2 }, 0)).toBe(false);
  });
});

describe('autoFinalDecision', () => {
  it('waits during and on the last day of the event', () => {
    expect(autoFinalDecision(base, at('2026-10-23'))).toBe('wait');
    expect(autoFinalDecision(base, at('2026-10-24'))).toBe('wait');
  });
  it('asks TBA about the finals from the day after the event', () => {
    expect(autoFinalDecision(base, at('2026-10-25'))).toBe('needs-finals-check');
    expect(autoFinalDecision(base, at('2026-10-26'))).toBe('needs-finals-check');
  });
  it(`finalizes any round ${BACKSTOP_DAYS} days after the event`, () => {
    expect(autoFinalDecision(base, at('2026-10-27'))).toBe('finalize');
    expect(autoFinalDecision({ ...base, kind: 'manual' }, at('2026-10-27'))).toBe('finalize');
    expect(autoFinalDecision({ ...base, kind: 'season' }, at('2026-10-27'))).toBe('finalize');
  });
  it('manual and season rounds never ask TBA, they only use the backstop', () => {
    expect(autoFinalDecision({ ...base, kind: 'manual' }, at('2026-10-25'))).toBe('wait');
    expect(autoFinalDecision({ ...base, kind: 'season' }, at('2026-10-26'))).toBe('wait');
  });
  it('leaves final, reopened and undrafted rounds alone', () => {
    const late = at('2026-11-30');
    expect(autoFinalDecision({ ...base, finalizedAt: '2026-10-27T10:00:00Z' }, late)).toBe('wait');
    expect(autoFinalDecision({ ...base, autoFinalize: false }, late)).toBe('wait');
    expect(autoFinalDecision({ ...base, draftComplete: false }, late)).toBe('wait');
  });
  it('uses the event timezone: 11:30 pm Pacific on the last day is still the last day', () => {
    const west = { ...base, timezone: 'America/Los_Angeles' };
    expect(autoFinalDecision(west, new Date('2026-10-25T06:30:00Z'))).toBe('wait');
    expect(autoFinalDecision(west, new Date('2026-10-25T08:30:00Z'))).toBe('needs-finals-check');
  });
  it('falls back to Eastern when the timezone is unknown', () => {
    expect(autoFinalDecision({ ...base, timezone: null }, at('2026-10-25'))).toBe('needs-finals-check');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/rounds/autoFinal.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** `lib/rounds/autoFinal.ts`:

```ts
import type { RoundKind } from '@/lib/db/types';
import { addDays, localDate } from '@/lib/rounds/status';

/** Spec 2026-10-02 §4: any round is finalized this many days after its event ends. */
export const BACKSTOP_DAYS = 3;

export type AutoFinalInput = {
  kind: RoundKind;
  endDate: string;
  timezone: string | null;
  finalizedAt: string | null;
  autoFinalize: boolean;
  draftComplete: boolean;
};
export type AutoFinalDecision = 'finalize' | 'needs-finals-check' | 'wait';

export function draftComplete(round: { draftOrder: string[]; rosterSize: number }, pickCount: number): boolean {
  const total = round.draftOrder.length * round.rosterSize;
  return total > 0 && pickCount >= total;
}

/**
 * What the daily job should do with one round (spec 2026-10-02 §4). 'needs-finals-check' means a TBA
 * round on or after the day after its event: finalize it only if TBA shows the finals decided.
 */
export function autoFinalDecision(r: AutoFinalInput, now: Date): AutoFinalDecision {
  if (r.finalizedAt || !r.autoFinalize || !r.draftComplete) return 'wait';
  const today = localDate(now, r.timezone);
  if (today >= addDays(r.endDate, BACKSTOP_DAYS)) return 'finalize';
  if (r.kind === 'tba' && today > r.endDate) return 'needs-finals-check';
  return 'wait';
}
```

- [ ] **Step 4: Run** `npx vitest run tests/rounds/autoFinal.test.ts` → PASS; then `npx vitest run && npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat: auto-finalize decision rule`.

### Task 3: The daily job

**Files:**
- Create: `lib/cron/autoFinalize.ts`, `tests/cron/autoFinalize.test.ts`
- Modify: `lib/cron/jobs.ts` (add first), `tests/cron/jobOrder.test.ts` (expected order)

**Interfaces:**
- Consumes: `Repo.listAutoFinalizeCandidates`, `repo.listPicksForRounds(ids)`, `repo.updateRound(id, { finalizedAt })` (Task 1); `autoFinalDecision`, `draftComplete` (Task 2); `getTba` (`lib/tba/client.ts`), `eventPaths` (`lib/tba/event.ts`), `cacheWindowFor` (`lib/rounds/status.ts`), `finalsResult` (`lib/scoring/playoffs.ts`), types `Alliance`, `MatchSimple` (`lib/tba/types.ts`); `DailyJob` (`lib/cron/jobs.ts`).
- Produces:
  ```ts
  export type AutoFinalizeSummary = { finalized: string[]; waitingOnFinals: string[]; errors: { roundId: string; message: string }[] };
  export async function autoFinalizeRounds(repo: Repo, now: Date, deadline: number, clock?: () => number): Promise<AutoFinalizeSummary>;
  export const autoFinalizeJob: DailyJob; // name 'auto-finalize'
  ```

- [ ] **Step 1: Write the failing test** `tests/cron/autoFinalize.test.ts`. Mock the TBA client like `tests/views/home.test.ts` / `tests/views/liveDrafts.test.ts` do (`const h = vi.hoisted(() => ({ getTba: vi.fn() }))` + `vi.mock('@/lib/tba/client', () => ({ getTba: (...a: unknown[]) => h.getTba(...a) }))`). Seed with `createMemoryRepo` (a `seed(repo, { kind, eventKey, endDate, picks, autoFinalize?, finalizedAt? })` helper: draftOrder of 2 players, rosterSize 2, so 4 picks = complete; use the repo's own create/update methods). For TBA responses read `fromStatus`/`fromFinalsMatches` in `lib/scoring/playoffs.ts` and build: **decided** = `/event/{key}/alliances` returns two alliances where #1 has the status shape `fromStatus` reads as the winner and #2 as finalist, `/event/{key}/matches/simple` returns `[]`; **undecided** = alliances with no won status and matches `[]`. `getTba` resolves `{ data, fetchedAt: '2026-10-25T09:00:00.000Z', stale: false }`. Use `NOW = new Date('2026-10-25T10:00:00Z')` (day after a `2026-10-24` event), `FAR = Number.MAX_SAFE_INTEGER` as the deadline. Write these cases with real assertions on the stored round afterwards (via the memory repo's round getter) and on the returned summary:
  1. TBA round, day after, decided → `finalizedAt === NOW.toISOString()`, id in `finalized`.
  2. TBA round, day after, undecided → `finalizedAt === null`, id in `waitingOnFinals`.
  3. Backstop at `2026-10-27T10:00:00Z`: a `manual`, a `season` (eventKey null) and a `tba` round all finalized; `h.getTba` never called (the TBA round is past the backstop too).
  4. Skips a reopened round (`autoFinalize: false`), an already-final round and an undrafted round (3 picks) at the backstop date — none touched, `getTba` not called.
  5. One failing round: `h.getTba` rejects for round A's paths and resolves decided for round B → B finalized, A not, `errors` has one entry with A's id.
  6. Deadline: `clock = () => 2`, `deadline = 1` → nothing finalized, `errors` empty.
  7. `DAILY_JOBS[0].name === 'auto-finalize'` (import from `@/lib/cron/jobs`).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `lib/cron/autoFinalize.ts`:

```ts
import type { DailyJob } from '@/lib/cron/jobs';
import { getRepo } from '@/lib/db';
import type { Repo } from '@/lib/db/repo';
import type { RoundRow } from '@/lib/db/types';
import { autoFinalDecision, draftComplete } from '@/lib/rounds/autoFinal';
import { cacheWindowFor } from '@/lib/rounds/status';
import { finalsResult } from '@/lib/scoring/playoffs';
import { getTba } from '@/lib/tba/client';
import { eventPaths } from '@/lib/tba/event';
import type { Alliance, MatchSimple } from '@/lib/tba/types';

export type AutoFinalizeSummary = {
  finalized: string[];
  waitingOnFinals: string[];
  errors: { roundId: string; message: string }[];
};

/** True when the cached TBA data shows who won the event's finals (the same rule that awards winner points). */
async function finalsDecided(round: RoundRow, now: Date): Promise<boolean> {
  if (!round.eventKey) return false;
  const paths = eventPaths(round.eventKey);
  const windowMs = cacheWindowFor(round, now);
  const [alliances, matches] = await Promise.all([
    getTba<Alliance[]>(paths.alliances, { windowMs }),
    getTba<MatchSimple[]>(paths.matches, { windowMs }),
  ]);
  const list = Array.isArray(alliances.data) ? alliances.data : null;
  const games = Array.isArray(matches.data) ? matches.data : null;
  return finalsResult(list, games).winner !== null;
}

/** Spec 2026-10-02 §5: finalize every round whose event is over, one round at a time, within the budget. */
export async function autoFinalizeRounds(
  repo: Repo,
  now: Date,
  deadline: number,
  clock: () => number = Date.now,
): Promise<AutoFinalizeSummary> {
  const summary: AutoFinalizeSummary = { finalized: [], waitingOnFinals: [], errors: [] };
  const rounds = await repo.listAutoFinalizeCandidates();
  if (rounds.length === 0) return summary;
  const picks = await repo.listPicksForRounds(rounds.map((r) => r.id));

  for (const round of rounds) {
    if (clock() >= deadline) break;
    try {
      const count = picks.filter((p) => p.roundId === round.id).length;
      const decision = autoFinalDecision(
        {
          kind: round.kind,
          endDate: round.endDate,
          timezone: round.timezone,
          finalizedAt: round.finalizedAt,
          autoFinalize: round.autoFinalize,
          draftComplete: draftComplete(round, count),
        },
        now,
      );
      if (decision === 'wait') continue;
      if (decision === 'needs-finals-check' && !(await finalsDecided(round, now))) {
        summary.waitingOnFinals.push(round.id);
        continue;
      }
      await repo.updateRound(round.id, { finalizedAt: now.toISOString() });
      summary.finalized.push(round.id);
    } catch (err) {
      console.error(`auto-finalize: round ${round.id} failed`, err);
      summary.errors.push({ roundId: round.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return summary;
}

export const autoFinalizeJob: DailyJob = {
  name: 'auto-finalize',
  async run(now, deadline) {
    const s = await autoFinalizeRounds(getRepo(), now, deadline);
    console.log(
      `auto-finalize: ${s.finalized.length} finalized, ${s.waitingOnFinals.length} waiting on finals, ${s.errors.length} errors`,
    );
  },
};
```

Check `getTba`'s real signature/return and `cacheWindowFor`'s parameter type (`RoundTiming`; a `RoundRow` satisfies it) and adapt. If importing the `DailyJob` type from `jobs.ts` while `jobs.ts` imports `autoFinalizeJob` causes a runtime cycle problem, move `DailyJob`/`JobResult` into `lib/cron/types.ts` and import from there in both files (keep re-exports from `jobs.ts` so existing imports keep working).

- [ ] **Step 4: Register** — in `lib/cron/jobs.ts`, import `autoFinalizeJob` and make it the first entry of `DAILY_JOBS`; update the comment above the array (auto-finalize is cheap: one DB read, then at most two cached TBA reads per just-ended TBA round). Update `tests/cron/jobOrder.test.ts` expectations to the new order.

- [ ] **Step 5: Run** `npx vitest run && npx tsc --noEmit` → green.
- [ ] **Step 6: Commit** — `feat: daily auto-finalize job`.

### Task 4: Reopen turns auto-finalize off; admin + label copy; docs

**Files:**
- Modify: `app/api/l/[slug]/admin/rounds/[id]/route.ts` (PATCH), `components/admin/RoundAdmin.tsx` (`WrapUpStep`), `components/admin/RoundChecklist.tsx` (step 4 preview), `lib/rounds/status.ts` (`STATUS_LABEL.awaiting_final`)
- Tests: the admin-round PATCH test file (grep `finalized: false` / `finalized: true` under `tests/api`), `tests/rounds/status.test.ts`, `tests/ui/admin-components.test.ts` and/or `tests/ui/admin-v3.test.ts`, `tests/ui/round-components.test.ts`
- Docs: `docs/superpowers/specs/2026-09-29-frc-fantasy-design.md` (§7.8), `CLAUDE.md` (Current status)

**Interfaces:**
- Consumes: `AdminRoundDetail['round'].autoFinalize` (Task 1).

- [ ] **Step 1: Write the failing tests.**
  - API (existing admin-round PATCH test file, same style): `PATCH {finalized:false}` on a final round → stored round has `finalizedAt === null` and `autoFinalize === false`; `PATCH {finalized:true}` on a fresh round → `finalizedAt` set and `autoFinalize === true`.
  - `tests/rounds/status.test.ts`: the `STATUS_LABEL` expectation becomes `awaiting_final: 'Results pending'`.
  - UI (render `WrapUpStep`'s output the way the existing round-admin tests render step content): not final + auto on → contains `This round finalizes on its own once the playoffs are done (or 3 days after the event). Mark it final now if results look complete.` and `Mark round final`; final → contains `Final. Scores still update if TBA changes; adjustments still work.` and `Reopen round`; not final + auto off → contains `Auto-finalize is off for this round.` and `Mark round final`. Also `stepSummaries(...)[4].preview === 'Finalizes on its own after the event'`.
  - Update existing tests that assert the label text `Awaiting final` to `Results pending` (leave test *names* alone).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - Route: in the `repo.updateRound(round.id, { … })` call add `autoFinalize: patch.finalized === false ? false : undefined,`.
  - `lib/rounds/status.ts`: `STATUS_LABEL.awaiting_final = 'Results pending'`.
  - `RoundChecklist.tsx` step 4: `preview: 'Finalizes on its own after the event'` (summary unchanged).
  - `WrapUpStep`: remove the `nudgeFinalize` warning Alert and the bottom footnote; render one muted paragraph by state — `round.finalizedAt` → "Final. Scores still update if TBA changes; adjustments still work."; not final and `round.autoFinalize` → "This round finalizes on its own once the playoffs are done (or 3 days after the event). Mark it final now if results look complete."; not final and `!round.autoFinalize` → "Auto-finalize is off for this round.". Keep both buttons and their API calls. Reopen first confirms with "Reopening keeps this round open until you mark it final again." (same confirm pattern the Delete button in this file uses); its success notice becomes "Round reopened — it stays open until you mark it final."
  - v1 spec §7.8: replace the bullet beginning "**Final only ever comes from the commissioner.**" with:
    ```md
    - **Final comes from the daily auto-finalize job or the commissioner** (spec `2026-10-02-auto-finalize-design.md` §4–5): a TBA round finalizes once TBA shows the finals decided (from the day after `end_date`); any round finalizes 3 days after `end_date`. Reopening a round turns auto-finalize off for that round.
    ```
    keep the "Finalizing does **not** freeze scores…" bullet, and in the status table rename **Awaiting final** to **Results pending** (condition unchanged; drop "(commissioner is nudged to finalize, §5.5)").
  - `CLAUDE.md` Current status: change the "UX overhaul (branch `ux-overhaul`, 2026-10-01): …" bullet to start "UX overhaul shipped (PR #8, 2026-10-02): …" (rest unchanged), and replace "Tabled for a later phase: auto-finalize rounds at event end." with "Auto-finalize (branch `auto-finalize`, spec `docs/superpowers/specs/2026-10-02-auto-finalize-design.md`): rounds finalize on their own after the event; needs migration 0006 applied before merge."
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit && npx next build` → green.
- [ ] **Step 5: Commit** — `feat: reopen turns auto-finalize off; Results pending; docs`.

---

## After the tasks

1. One whole-branch review (most capable model) + one fix wave if needed.
2. Push `auto-finalize`, open a PR. **Do not merge** until Joey has pasted `supabase/migrations/0006_auto_finalize.sql` into the Supabase SQL editor and `npx tsx scripts/db-smoke.ts` passes.
