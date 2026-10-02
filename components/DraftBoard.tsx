import { BumperPlate } from '@/components/ui/BumperPlate';
import { teamLabel } from '@/lib/teams';

type BoardPick = { pickNumber: number; playerId: string; teamKey: string };

/**
 * The draft board (UX §6.6): one column per player in draft order, one row per draft round, so each column
 * is that player's roster. With many players it is wider than a phone: the board scrolls sideways inside
 * its own container (the one allowed sideways scroll) and the page never does.
 */
export function DraftBoard({
  picks,
  draftOrder,
  rosterSize,
  playerNames,
  teamNames,
  highlightPick,
}: {
  picks: BoardPick[];
  draftOrder: string[];
  rosterSize: number;
  playerNames: Record<string, string>;
  teamNames: Record<string, string>;
  /** Rings this pick number (the newest pick in a live draft). */
  highlightPick?: number;
}) {
  const P = draftOrder.length;
  if (P === 0) return <p className="text-sm text-fg-muted">The draft order hasn&apos;t been set yet.</p>;

  const byNumber = new Map(picks.map((p) => [p.pickNumber, p]));
  const draftRounds = Array.from({ length: rosterSize }, (_, r) => r);
  // Columns share the width, but never get narrower than a 4-digit plate.
  const columns = { gridTemplateColumns: `repeat(${P}, minmax(0, 1fr))` };

  // relative: the sr-only cells are absolutely positioned and would otherwise widen the page, not the board.
  return (
    <div className="relative overflow-x-auto overscroll-x-contain pb-1">
      <div className="space-y-3" style={{ minWidth: `${P * 5}rem` }}>
        {/* Column heads. Screen readers get the picker in every cell instead. */}
        <div aria-hidden="true" className="grid gap-2 border-b border-border pb-2" style={columns}>
          {draftOrder.map((id) => (
            <span
              key={id}
              title={playerNames[id]}
              className="truncate text-center text-[13px] font-semibold leading-[18px] text-fg"
            >
              {playerNames[id] ?? 'Unknown'}
            </span>
          ))}
        </div>
        {draftRounds.map((r) => (
          <div key={r}>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[.12em] text-fg-muted">Round {r + 1}</p>
            <ol className="grid gap-2" style={columns}>
              {draftOrder.map((columnId, c) => {
                // Snake order: even rounds go forward through the order, odd rounds go backward.
                const n = r * P + (r % 2 === 0 ? c : P - 1 - c);
                const pick = byNumber.get(n);
                const who = playerNames[pick?.playerId ?? columnId] ?? 'Unknown';
                return (
                  <li
                    key={n}
                    data-newest={highlightPick === n ? 'true' : undefined}
                    className={`flex min-w-0 justify-center ${highlightPick === n ? 'rounded-xl ring-2 ring-accent-strong' : ''}`}
                  >
                    {/* Screen readers get the pick number and picker; sighted users see the plate under the name. */}
                    <span className="sr-only">
                      #{n + 1} · {who}
                      {pick ? '' : ', not picked yet'}
                    </span>
                    {pick ? (
                      <span title={teamNames[pick.teamKey]} className="max-w-full">
                        <BumperPlate number={teamLabel(pick.teamKey)} size="md" />
                      </span>
                    ) : (
                      <span
                        aria-hidden="true"
                        className="inline-flex h-10 min-w-14 items-center justify-center rounded-plate border border-dashed border-border font-display text-[22px] text-fg-muted"
                      >
                        —
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}
