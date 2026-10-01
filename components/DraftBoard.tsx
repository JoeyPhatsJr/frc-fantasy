import { BumperPlate } from '@/components/ui/BumperPlate';
import { teamLabel } from '@/lib/teams';

type BoardPick = { pickNumber: number; playerId: string; teamKey: string };

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

  return (
    <div className="space-y-5">
      {draftRounds.map((r) => (
        <div key={r}>
          <p className="mb-2 text-[13px] font-semibold leading-[18px] text-fg-muted">Round {r + 1}</p>
          {/* Cells wrap, so the board never scrolls sideways however many players there are. */}
          <ol className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4">
            {Array.from({ length: P }, (_, slot) => {
              const n = r * P + slot;
              const pick = byNumber.get(n);
              // Snake order: even rounds go forward through the order, odd rounds go backward.
              const pickerId = r % 2 === 0 ? draftOrder[slot] : draftOrder[P - 1 - slot];
              const who = playerNames[pick?.playerId ?? pickerId] ?? 'Unknown';
              return (
                <li
                  key={n}
                  data-newest={highlightPick === n ? 'true' : undefined}
                  className={`flex min-w-0 flex-col items-center gap-1 ${highlightPick === n ? 'rounded-xl ring-2 ring-accent-strong' : ''}`}
                >
                  {/* Screen readers get the pick number and picker; sighted users see the plate and name. */}
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
                  <span
                    aria-hidden="true"
                    className="w-full truncate text-center text-[13px] leading-[18px] text-fg-muted"
                    title={who}
                  >
                    {who}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}
