import { signed, teamName } from '@/lib/format';

type ListedAdjustment = {
  id: string;
  playerId: string | null;
  teamKey: string | null;
  points: number;
  reason: string;
};

export function AdjustmentList({
  adjustments,
  playerNames,
  teamNames,
}: {
  adjustments: ListedAdjustment[];
  playerNames: Record<string, string>;
  teamNames: Record<string, string>;
}) {
  if (adjustments.length === 0) return <p className="text-sm text-fg-muted">No adjustments.</p>;
  return (
    <ul className="space-y-2">
      {adjustments.map((a) => {
        const target = a.playerId
          ? (playerNames[a.playerId] ?? 'Unknown player')
          : `Team ${teamName(a.teamKey ?? '', teamNames)}`;
        return (
          <li
            key={a.id}
            className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-fg" title={target}>
                {target}
              </span>
              <span className="block break-words text-sm text-fg">{a.reason}</span>
            </span>
            {/* Gold chip for a bonus, red chip for a penalty; both keep text ≥ 4.5:1. */}
            <span
              className={[
                'shrink-0 rounded-pill px-2.5 py-0.5 font-display text-lg font-bold tabular-nums',
                a.points < 0 ? 'bg-red-alliance text-on-primary' : 'bg-accent text-fg',
              ].join(' ')}
            >
              {signed(a.points)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
