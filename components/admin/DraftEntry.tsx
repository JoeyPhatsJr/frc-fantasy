'use client';

import { useEffect, useRef, useState } from 'react';
import type { SectionProps } from '@/components/admin/RoundAdmin';
import { usePending } from '@/components/admin/usePending';
import { DraftBoard } from '@/components/DraftBoard';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { BumperPlate } from '@/components/ui/BumperPlate';
import { Check, Replace } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { availableTeams, draftBanner } from '@/lib/draft';
import { pickerFor } from '@/lib/scoring/round';
import { teamLabel } from '@/lib/teams';

const SHOW_AT_MOST = 60;

const SUBHEAD = 'font-display text-[17px] font-bold leading-6 text-fg';

// A cell reacts the instant it's touched (active:), then keeps the gold ring while its pick saves.
// Focus uses an outline, so it never hides behind (or reads as) the gold pressed ring.
const CELL =
  'relative flex min-h-14 w-full min-w-0 cursor-pointer select-none flex-col items-center justify-center gap-1 ' +
  'rounded-xl border border-border bg-surface px-2 py-2 motion-safe:transition duration-150 ' +
  'hover:bg-surface-2 active:ring-2 active:ring-accent motion-safe:active:scale-[0.97] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
  'disabled:cursor-not-allowed';
const CELL_IDLE = 'disabled:opacity-50';
const CELL_SAVING = 'ring-2 ring-accent';

export type Banner =
  | { kind: 'no-order' }
  | { kind: 'complete'; total: number }
  | { kind: 'pick'; pick: number; total: number; picker: string; draftRound: number };

/** The same facts as `draftBanner()` (lib/draft.ts), split into the big number and the line under it. */
export function bannerParts(
  pickCount: number,
  draftOrder: string[],
  rosterSize: number,
  playerNames: Record<string, string>,
): Banner {
  const P = draftOrder.length;
  if (P === 0) return { kind: 'no-order' };
  const total = P * rosterSize;
  if (pickCount >= total) return { kind: 'complete', total };
  return {
    kind: 'pick',
    pick: pickCount + 1,
    total,
    picker: playerNames[pickerFor(pickCount, draftOrder)] ?? 'Unknown',
    draftRound: Math.floor(pickCount / P) + 1,
  };
}

function DraftBanner({ banner, text }: { banner: Banner; text: string }) {
  const tone = banner.kind === 'complete' ? 'bg-success text-on-success' : 'bg-primary-fill text-on-primary';
  return (
    <div className={`rounded-card px-4 py-4 ${tone}`}>
      {/* Screen readers hear the one-line banner; the big layout below is for eyes. */}
      <p aria-live="polite" className="sr-only">
        {text}
      </p>
      <div aria-hidden="true">
        {banner.kind === 'no-order' ? (
          <p className="font-display text-[22px] font-bold leading-[26px]">{text}</p>
        ) : banner.kind === 'complete' ? (
          <>
            <p className="flex items-center gap-2 font-display text-[56px] font-bold leading-[56px]">
              <Check className="size-10 shrink-0" />
              <span className="min-w-0 break-words">Draft complete</span>
            </p>
            <p className="mt-1 text-[17px] font-semibold leading-6 tabular-nums">
              {banner.total} of {banner.total} picks
            </p>
          </>
        ) : (
          <>
            {/* Two no-wrap chunks, so a long count wraps as "Pick 17" / "of 20", never mid-phrase. */}
            <p className="flex flex-wrap gap-x-3 font-display text-[56px] font-bold leading-[56px] tabular-nums">
              <span className="whitespace-nowrap">Pick {banner.pick}</span>
              <span className="whitespace-nowrap">of {banner.total}</span>
            </p>
            <p className="mt-1 break-words text-[17px] font-semibold leading-6">
              {banner.picker}&apos;s turn, round {banner.draftRound}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export function DraftEntry({ detail, busy, run, api, playerNames }: SectionProps) {
  const { round, picks, pool } = detail;
  const [query, setQuery] = useState('');
  const [replacing, setReplacing] = useState<number | null>(null);
  const { pending, go } = usePending(run);
  const replaceNote = useRef<HTMLDivElement>(null);

  const total = round.draftOrder.length * round.rosterSize;
  const complete = total > 0 && picks.length >= total;
  const canPick = round.draftOrder.length > 0 && (!complete || replacing !== null);
  const available = availableTeams(pool, picks, query);
  const teamNames = Object.fromEntries(pool.map((t) => [t.teamKey, t.nickname ?? '']));

  // "Replace" sits below the board; bring the team list back into view so the next tap is obvious.
  useEffect(() => {
    if (replacing === null) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    replaceNote.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, [replacing]);

  function choose(teamKey: string) {
    setQuery('');
    if (replacing !== null) {
      const n = replacing;
      setReplacing(null);
      go(
        `team:${teamKey}`,
        () => api(`/rounds/${round.id}/picks/${n}`, { method: 'PATCH', body: { teamKey } }),
        `Pick ${n + 1} is now ${teamLabel(teamKey)}.`,
      );
    } else {
      // expectedPickNumber makes a second tab's stale click fail loudly instead of double-picking.
      go(`team:${teamKey}`, () =>
        api(`/rounds/${round.id}/picks`, { method: 'POST', body: { expectedPickNumber: picks.length, teamKey } }),
      );
    }
  }

  return (
    <div className="space-y-5">
      <DraftBanner
        banner={bannerParts(picks.length, round.draftOrder, round.rosterSize, playerNames)}
        text={draftBanner({
          pickCount: picks.length,
          draftOrder: round.draftOrder,
          rosterSize: round.rosterSize,
          playerNames,
        })}
      />

      {replacing !== null ? (
        <div ref={replaceNote} className="scroll-mt-20">
          <Alert tone="warning">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Replacing pick {replacing + 1} ({teamLabel(picks[replacing]?.teamKey ?? '')}). Tap the new team.
              </span>
              <Button type="button" variant="secondary" size="sm" onClick={() => setReplacing(null)}>
                Cancel
              </Button>
            </div>
          </Alert>
        </div>
      ) : null}

      {canPick ? (
        <div className="space-y-3">
          {/* Stays under the 56px sticky site header while the grid scrolls (the league bar doesn't stick).
              Bleeds to the card's edges so rows scrolling under it are hidden. */}
          <div className="sticky top-[56px] z-10 -mx-4 bg-surface px-4 py-2">
            <Input
              label="Search available teams"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by number or name"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              enterKeyHint="search"
            />
          </div>
          {available.length === 0 ? <p className="text-[15px] text-fg-muted">No available teams match.</p> : null}
          <ul className="grid grid-cols-2 gap-3">
            {available.slice(0, SHOW_AT_MOST).map((t) => {
              const saving = pending === `team:${t.teamKey}`;
              return (
                <li key={t.teamKey} className="min-w-0">
                  <button
                    type="button"
                    disabled={busy}
                    aria-busy={saving || undefined}
                    onClick={() => choose(t.teamKey)}
                    className={`${CELL} ${saving ? CELL_SAVING : CELL_IDLE}`}
                  >
                    <BumperPlate number={t.label} size="lg" className="max-w-full" />
                    <span className="w-full truncate text-center text-[13px] leading-[18px] text-fg-muted">
                      {t.nickname ?? (t.manual ? 'added by hand' : '')}
                    </span>
                    {saving ? (
                      <span
                        aria-hidden="true"
                        className="absolute top-2 right-2 size-4 shrink-0 rounded-full border-2 border-accent-text border-r-transparent motion-safe:animate-spin"
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {available.length > SHOW_AT_MOST ? (
            <p className="text-[13px] leading-[18px] text-fg-muted">
              Showing {SHOW_AT_MOST} of {available.length}. Type to narrow the list.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="danger"
          busy={pending === 'undo'}
          disabled={busy || picks.length === 0}
          onClick={() => {
            const last = picks[picks.length - 1];
            setReplacing(null);
            go(
              'undo',
              () => api(`/rounds/${round.id}/picks/${last.pickNumber}`, { method: 'DELETE' }),
              `Undid pick ${last.pickNumber + 1}.`,
            );
          }}
        >
          Undo last pick
        </Button>
      </div>

      <div className="space-y-2">
        <h3 className={SUBHEAD}>Draft board</h3>
        <DraftBoard
          picks={picks}
          draftOrder={round.draftOrder}
          rosterSize={round.rosterSize}
          playerNames={playerNames}
          teamNames={teamNames}
        />
      </div>

      {picks.length > 0 ? (
        <div className="space-y-2">
          <h3 className={SUBHEAD}>Replace a pick</h3>
          <p className="text-[13px] leading-[18px] text-fg-muted">
            For a team that withdrew. The pick keeps its number and owner.
          </p>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {picks.map((p) => (
              <li
                key={p.pickNumber}
                className={`flex min-h-14 items-center gap-3 py-1.5 pr-1.5 pl-3 ${replacing === p.pickNumber ? 'bg-accent/10' : ''}`}
              >
                <span className="w-9 shrink-0 text-[13px] leading-[18px] text-fg-muted tabular-nums">
                  #{p.pickNumber + 1}
                </span>
                <BumperPlate number={teamLabel(p.teamKey)} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[15px] text-fg-muted">
                  {playerNames[p.playerId] ?? 'Unknown'}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  disabled={busy}
                  aria-label={`Replace pick ${p.pickNumber + 1} (${teamLabel(p.teamKey)})`}
                  title="Replace"
                  onClick={() => setReplacing(p.pickNumber)}
                >
                  <Replace className="size-5" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
