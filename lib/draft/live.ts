// Pure live-draft rules (spec §7). Safe to import in the browser: no database or Node imports.
import type { PickSeconds, RoundRow } from '@/lib/db/types';
import { pickerFor } from '@/lib/scoring/round';

export type DraftPhase = 'setup' | 'live' | 'paused' | 'done';
export type DraftRoundFields = Pick<
  RoundRow,
  'draftMode' | 'draftStartedAt' | 'draftPausedAt' | 'rosterSize' | 'draftOrder'
>;
type Size = Pick<RoundRow, 'rosterSize' | 'draftOrder'>;

/** Spec §7.1: a resumed pick never gets less than this, even if the clock had run out. */
export const RESUME_FLOOR_MS = 10_000;

export function totalPicks(round: Size): number {
  return round.rosterSize * round.draftOrder.length;
}

export function draftPhase(round: DraftRoundFields, pickCount: number): DraftPhase {
  const total = totalPicks(round);
  if (total > 0 && pickCount >= total) return 'done';
  if (round.draftMode !== 'live' || !round.draftStartedAt) return 'setup';
  return round.draftPausedAt ? 'paused' : 'live';
}

export function onClockPlayer(round: Size, pickCount: number): string | null {
  if (round.draftOrder.length === 0 || pickCount >= totalPicks(round)) return null;
  return pickerFor(pickCount, round.draftOrder);
}

/** Picks before `playerId` is on the clock: 0 = now, null = no turns left. */
export function picksUntilTurn(round: Size, pickCount: number, playerId: string): number | null {
  const total = totalPicks(round);
  for (let n = pickCount; n < total; n++) {
    if (pickerFor(n, round.draftOrder) === playerId) return n - pickCount;
  }
  return null;
}

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Epoch ms for a server timestamp. Postgres sends microseconds and a +00:00 offset
 * ("2026-10-23T23:15:42.123456+00:00"); the extra digits are dropped first, because ECMAScript only
 * promises to parse milliseconds and older iPhone Safari is stricter than Node about it.
 */
export function parseTimestamp(ts: string): number {
  return Date.parse(ts.replace(/(\.\d{3})\d+/, '$1'));
}

/** The deadline after a pick. `picksAfter` counts the picks made including the one just made. */
export function nextDeadline(
  pickSeconds: PickSeconds | null,
  picksAfter: number,
  total: number,
  nowMs: number,
): string | null {
  if (pickSeconds === null || picksAfter >= total) return null;
  return iso(nowMs + pickSeconds * 1000);
}

/** Time left on the clock when pausing; never negative. */
export function pausedRemainingMs(pickDeadline: string | null, nowMs: number): number | null {
  if (!pickDeadline) return null;
  return Math.max(0, parseTimestamp(pickDeadline) - nowMs);
}

/**
 * The time on the clock right after resume: a saved remainder gets at least RESUME_FLOOR_MS; a cleared
 * remainder (null, e.g. after an undo while paused) gets the full pick timer; no timer gives null.
 */
export function resumeRemainingMs(pickSeconds: PickSeconds | null, remaining: number | null): number | null {
  if (pickSeconds === null) return null;
  return remaining === null ? pickSeconds * 1000 : Math.max(remaining, RESUME_FLOOR_MS);
}

/**
 * The deadline on resume. A saved remainder gets at least RESUME_FLOOR_MS; a cleared remainder
 * (null, e.g. after an undo while paused) gets the full pick timer. The caller must not call this
 * for a draft that is already complete (a finished draft resumes with no deadline).
 */
export function resumeDeadline(
  pickSeconds: PickSeconds | null,
  remaining: number | null,
  nowMs: number,
): string | null {
  const ms = resumeRemainingMs(pickSeconds, remaining);
  return ms === null ? null : iso(nowMs + ms);
}

function teamSortParts(teamKey: string): [number, string] {
  const m = /^frc([0-9]+)([A-Z]?)$/.exec(teamKey);
  return m ? [Number(m[1]), m[2]] : [Number.MAX_SAFE_INTEGER, teamKey];
}

/** Spec §7.4: queue first; then highest projection; "New" (null) after projected; then lowest team number. */
export function chooseAutoPick(
  queue: string[],
  available: { teamKey: string; proj: number | null }[],
): string | null {
  const open = new Set(available.map((t) => t.teamKey));
  const queued = queue.find((k) => open.has(k));
  if (queued) return queued;
  if (available.length === 0) return null;
  const best = [...available].sort((a, b) => {
    if (a.proj !== null && b.proj !== null && a.proj !== b.proj) return b.proj - a.proj;
    if ((a.proj === null) !== (b.proj === null)) return a.proj === null ? 1 : -1;
    const [an, as] = teamSortParts(a.teamKey);
    const [bn, bs] = teamSortParts(b.teamKey);
    return an - bn || as.localeCompare(bs);
  });
  return best[0].teamKey;
}

/** Spec §7.5: offset = serverNow − (receivedAt − rtt/2), in ms. Add it to Date.now() to get server time. */
export function clockOffset(serverNow: string, sentAtMs: number, receivedAtMs: number): number {
  const rtt = receivedAtMs - sentAtMs;
  return parseTimestamp(serverNow) - (receivedAtMs - rtt / 2);
}

export function remainingMs(deadline: string | null, offsetMs: number, localNowMs: number): number | null {
  if (!deadline) return null;
  return Math.max(0, parseTimestamp(deadline) - (localNowMs + offsetMs));
}
