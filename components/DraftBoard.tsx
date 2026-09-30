import { teamLabel } from '@/lib/teams';

type BoardPick = { pickNumber: number; playerId: string; teamKey: string };

export function DraftBoard({
  picks,
  draftOrder,
  rosterSize,
  playerNames,
  teamNames,
}: {
  picks: BoardPick[];
  draftOrder: string[];
  rosterSize: number;
  playerNames: Record<string, string>;
  teamNames: Record<string, string>;
}) {
  const P = draftOrder.length;
  if (P === 0) return <p className="text-sm text-fg-muted">The draft order hasn&apos;t been set yet.</p>;

  const byNumber = new Map(picks.map((p) => [p.pickNumber, p]));
  const draftRounds = Array.from({ length: rosterSize }, (_, r) => r);

  return (
    <div className="space-y-4">
      {draftRounds.map((r) => (
        <div key={r}>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">Round {r + 1}</p>
          {/* Cells wrap, so the board never scrolls sideways however many players there are. */}
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Array.from({ length: P }, (_, slot) => {
              const n = r * P + slot;
              const pick = byNumber.get(n);
              // Snake order: even rounds go forward through the order, odd rounds go backward.
              const pickerId = r % 2 === 0 ? draftOrder[slot] : draftOrder[P - 1 - slot];
              const who = playerNames[pick?.playerId ?? pickerId] ?? 'Unknown';
              return (
                <li
                  key={n}
                  className={[
                    'min-w-0 rounded-lg border px-2.5 py-1.5',
                    pick ? 'border-border bg-surface' : 'border-dashed border-fg-muted/40 bg-surface-2',
                  ].join(' ')}
                >
                  <p className="truncate text-xs text-fg-muted" title={who}>
                    #{n + 1} · {who}
                  </p>
                  <p
                    className={[
                      'truncate font-display text-lg font-bold leading-tight tabular-nums',
                      pick ? 'text-fg' : 'text-fg-muted',
                    ].join(' ')}
                    title={pick ? teamNames[pick.teamKey] : undefined}
                  >
                    {pick ? teamLabel(pick.teamKey) : '—'}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}
