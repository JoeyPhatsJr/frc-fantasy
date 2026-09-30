'use client';

import { useEffect, useRef, useState } from 'react';
import type { SectionProps } from '@/components/admin/RoundAdmin';
import { usePending } from '@/components/admin/usePending';
import { DraftBoard } from '@/components/DraftBoard';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Check } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { availableTeams, draftBanner } from '@/lib/draft';
import { teamLabel } from '@/lib/teams';

const SHOW_AT_MOST = 60;

const SUBHEAD = 'font-display text-lg font-bold uppercase tracking-wide text-fg';

// A chip reacts the instant it's touched (active:), then keeps the highlight while its pick saves.
const CHIP =
  'flex min-h-12 w-full min-w-0 cursor-pointer select-none flex-col items-start justify-center rounded-xl border px-3 py-1.5 ' +
  'text-left shadow-sm motion-safe:transition duration-150 ' +
  'hover:border-primary/60 active:border-primary active:bg-primary/10 motion-safe:active:scale-[0.97] ' +
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
  'disabled:cursor-not-allowed';
const CHIP_IDLE = 'border-border bg-surface disabled:opacity-50';
const CHIP_SAVING = 'border-primary bg-primary/10';

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
      <p
        aria-live="polite"
        className="flex items-center justify-center gap-2 rounded-card bg-primary-fill px-4 py-4 text-center font-display text-2xl font-bold leading-tight tracking-wide text-on-primary shadow-card"
      >
        {complete ? <Check className="size-6 shrink-0" /> : null}
        <span className="min-w-0 break-words">
          {draftBanner({ pickCount: picks.length, draftOrder: round.draftOrder, rosterSize: round.rosterSize, playerNames })}
        </span>
      </p>

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
          {available.length === 0 ? <p className="text-sm text-fg-muted">No available teams match.</p> : null}
          <ul className="grid grid-cols-2 gap-2">
            {available.slice(0, SHOW_AT_MOST).map((t) => {
              const saving = pending === `team:${t.teamKey}`;
              return (
                <li key={t.teamKey} className="min-w-0">
                  <button
                    type="button"
                    disabled={busy}
                    aria-busy={saving || undefined}
                    onClick={() => choose(t.teamKey)}
                    className={`${CHIP} ${saving ? CHIP_SAVING : CHIP_IDLE}`}
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="font-display text-2xl font-bold leading-none text-fg tabular-nums">{t.label}</span>
                      {saving ? (
                        <span
                          aria-hidden="true"
                          className="ml-auto size-4 shrink-0 rounded-full border-2 border-primary border-r-transparent motion-safe:animate-spin"
                        />
                      ) : null}
                    </span>
                    <span className="w-full truncate text-xs text-fg-muted">
                      {t.nickname ?? (t.manual ? 'added by hand' : '')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {available.length > SHOW_AT_MOST ? (
            <p className="text-xs text-fg-muted">
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
          <p className="text-xs text-fg-muted">For a team that withdrew. The pick keeps its number and owner.</p>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {picks.map((p) => (
              <li
                key={p.pickNumber}
                className={`flex min-h-12 items-center gap-2 px-3 py-1 ${replacing === p.pickNumber ? 'bg-accent/10' : ''}`}
              >
                <span className="w-9 shrink-0 text-sm text-fg-muted tabular-nums">#{p.pickNumber + 1}</span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-display text-lg font-bold text-fg tabular-nums">{teamLabel(p.teamKey)}</span>{' '}
                  <span className="text-sm text-fg-muted">{playerNames[p.playerId] ?? 'Unknown'}</span>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  disabled={busy}
                  aria-label={`Replace pick ${p.pickNumber + 1} (${teamLabel(p.teamKey)})`}
                  onClick={() => setReplacing(p.pickNumber)}
                >
                  Replace
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
