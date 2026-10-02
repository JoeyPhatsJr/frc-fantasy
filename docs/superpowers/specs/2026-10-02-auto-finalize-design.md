# FRC Fantasy — Auto-finalize rounds

**Date:** 2026-10-02 · **Status:** approved in brainstorming (Joey, 2026-10-02 16:53–17:08) · **Branch:** `auto-finalize`

Amends v1 spec §7.8 (round status) and the round-admin "Wrap up" step of the UX overhaul spec (§7.2). Everything else (scoring, caching windows, status derivation for the other statuses) is unchanged.

## 1. Why

Joey (2026-10-01): *"why when i finish drafting does it say awaiting final on the admin panel. it should conclude automatically at the events end."* Today a round sits in **Awaiting final** from the day after its event until the commissioner taps **Mark round final** (v1 §7.8: "Final only ever comes from the commissioner").

**Success:** after an event, rounds become Final on their own without the commissioner doing anything; late TBA data still flows in; a commissioner who reopens a round keeps it open.

Context that shapes the design:
- Finalizing never freezes scores (they are always computed from TBA data + picks + adjustments). It only sets the Final badge and moves the round to the 24 h cache window (§7.3).
- Final rounds still accept adjustments and manual results; only live-draft controls refuse a final round.
- "Start next season" (full-season leagues) requires the previous season round to be final.
- The daily cron (`/api/cron/daily`, 10:00 UTC = 6 am Eastern, 50 s budget) runs `DAILY_JOBS` in `lib/cron/jobs.ts`.

## 2. Decisions (locked in brainstorming)

| # | Question | Choice |
|---|---|---|
| A1 | Trigger | **Playoffs done, or a few days later:** a TBA round finalizes once it's at least the day after `end_date` and TBA shows the finals decided; any round finalizes 3 days after `end_date` regardless (backstop) |
| A2 | Reopen | **Stays open until re-marked:** reopening turns auto-finalize off for that round (new column) |

## 3. Data

Migration `supabase/migrations/0006_auto_finalize.sql` (Joey pastes it into the Supabase SQL editor; the branch must not merge before it is applied):

```sql
alter table rounds add column auto_finalize boolean not null default true;
```

`RoundRow` gains `autoFinalize: boolean`; `RoundPatch` gains `autoFinalize?: boolean`; the Supabase repo maps `auto_finalize`; the in-memory test repo defaults it to `true`. `scripts/db-smoke.ts` checks the column exists.

## 4. The rule — `lib/rounds/autoFinal.ts`

```ts
export const BACKSTOP_DAYS = 3;
export type AutoFinalInput = {
  kind: RoundKind;                 // 'tba' | 'manual' | 'season'
  endDate: string;                 // YYYY-MM-DD
  timezone: string | null;
  finalizedAt: string | null;
  autoFinalize: boolean;
  draftComplete: boolean;          // picks >= draftOrder.length * rosterSize, and that total > 0
};
export type AutoFinalDecision = 'finalize' | 'needs-finals-check' | 'wait';
export function autoFinalDecision(r: AutoFinalInput, now: Date): AutoFinalDecision;
```

With `today = localDate(now, r.timezone)`:

1. `finalizedAt` set, `autoFinalize` false, or `!draftComplete` → `'wait'` (never-drafted rounds are left alone).
2. `today >= addDays(endDate, BACKSTOP_DAYS)` → `'finalize'` (any kind).
3. `kind === 'tba'` and `today > endDate` → `'needs-finals-check'` (the job asks TBA).
4. Otherwise → `'wait'`.

Manual and season rounds only ever finalize through the backstop. Season rounds' `end_date` is the season's last official event (kept current by the existing season-dates job), so a finished season finalizes 3 days after its last event, which also unlocks "Start next season".

**Finals decided** = `finalsResult(alliances, matches)` from `lib/scoring/playoffs.ts` reports a winner — the same function that awards winner/finalist points, so the badge and the scores can't disagree.

## 5. The job — `auto-finalize` in `lib/cron/autoFinalize.ts`

Added **first** in `DAILY_JOBS` (cheap and bounded):

1. Load candidate rounds from the database: not finalized and `auto_finalize = true`, with each round's pick count (using existing repo reads where possible; a new read-only repo method only if needed — the plan decides).
2. For each: `autoFinalDecision`. On `'needs-finals-check'`, read the event's alliances and matches through the existing cached TBA client (`getTba` with the round's normal cache window — the same `tba_cache` path the round page uses) and finalize only when `finalsResult` has a winner.
3. Finalize = `repo.updateRound(id, { finalizedAt: now.toISOString() })`.
4. Each round is wrapped in try/catch: a failure is logged and the job continues. Stop starting new rounds once `Date.now() >= deadline`.
5. Log one summary line: `auto-finalize: N finalized, M waiting on finals, K errors`.

## 6. Reopen and Mark final

`PATCH /api/l/{slug}/admin/rounds/{id}` with `{ finalized: false }` (Reopen) now also sets `autoFinalize: false`. `{ finalized: true }` (Mark final) is unchanged. No other API change.

## 7. UI copy

- `STATUS_LABEL.awaiting_final`: **"Results pending"** (was "Awaiting final"); `leagueStatusLine` keeps "event over".
- Round admin step 4 "Wrap up" (`components/admin/RoundChecklist.tsx` / `RoundAdmin.tsx`):
  - Not final, auto on: "This round finalizes on its own once the playoffs are done (or 3 days after the event). Mark it final now if results look complete." + **Mark round final**.
  - Final: "Final. Scores still update if TBA changes; adjustments still work." + **Reopen round** (confirm: "Reopening keeps this round open until you mark it final again.").
  - Not final, auto off: muted note "Auto-finalize is off for this round." + **Mark round final**.
  - Step 4 summary when done: "Final"; preview: "Finalizes on its own after the event".

## 8. Spec amendment (v1 §7.8)

Replace "Final only ever comes from the commissioner. Dates alone never make a round Final…" with: "Final comes from the daily auto-finalize job (spec 2026-10-02 §4–5) or the commissioner. Reopening a round turns auto-finalize off for that round. Finalizing never freezes scores."

## 9. Testing

- `tests/rounds/autoFinal.test.ts`: every kind × (before end, end day, day after, backstop day) × finals-check outcome × finalized × auto off × not drafted; timezone edge (11:30 pm Eastern on `end_date`).
- `tests/cron/autoFinalize.test.ts` (memory repo + mocked `getTba`): finalizes a TBA round with a decided final the day after; leaves an undecided one; backstop finalizes manual/season/TBA; skips reopened rounds; one round's TBA error doesn't stop the others; respects the deadline.
- API test: Reopen sets `autoFinalize` false; Mark final leaves it.
- UI tests: the three step-4 copies; "Results pending" label.
- `db-smoke`: `auto_finalize` column present (after Joey runs 0006).

## 10. Rollout

Branch `auto-finalize` → PR. Joey runs `0006_auto_finalize.sql` in the Supabase SQL editor, then `db-smoke`, then merge. On the first 6 am run after merge, any already-ended, fully drafted rounds older than 3 days finalize.
