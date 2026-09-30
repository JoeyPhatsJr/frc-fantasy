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
    <ul className="divide-y divide-border">
      {adjustments.map((a) => {
        const target = a.playerId
          ? (playerNames[a.playerId] ?? 'Unknown player')
          : `Team ${teamName(a.teamKey ?? '', teamNames)}`;
        return (
          <li key={a.id} className="flex min-h-14 items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block break-words text-[15px] font-medium leading-[22px] text-fg">{a.reason}</span>
              <span className="block truncate text-[13px] leading-[18px] text-fg-muted" title={target}>
                {target}
              </span>
            </span>
            {/* Gold pill for a bonus, red pill for a penalty; both keep text ≥ 4.5:1. */}
            <span
              className={[
                'inline-flex h-8 min-w-12 shrink-0 items-center justify-center rounded-pill px-3',
                'font-display text-[17px] font-bold leading-none tabular-nums',
                a.points < 0 ? 'bg-red-alliance text-on-primary' : 'bg-accent text-on-accent',
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
