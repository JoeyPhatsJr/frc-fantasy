import { Row } from '@/components/ui/Row';
import { signed, teamName } from '@/lib/format';

type ListedAdjustment = {
  id: string;
  playerId: string | null;
  teamKey: string | null;
  points: number;
  reason: string;
};

/** Hand-added points as rows: reason, who it's for, signed points (spec §6.5). */
export function AdjustmentList({
  adjustments,
  playerNames,
  teamNames,
}: {
  adjustments: ListedAdjustment[];
  playerNames: Record<string, string>;
  teamNames: Record<string, string>;
}) {
  if (adjustments.length === 0) return <p className="px-4 py-3 text-sm text-fg-muted">No adjustments.</p>;
  return (
    <div>
      {adjustments.map((a) => {
        const target = a.playerId
          ? (playerNames[a.playerId] ?? 'Unknown player')
          : `Team ${teamName(a.teamKey ?? '', teamNames)}`;
        return (
          <Row
            key={a.id}
            title={a.reason}
            subtitle={target}
            trailing={
              // Gold for a bonus, red for a penalty; both ≥ 4.5:1 in both themes.
              <span
                className={`font-display text-[19px] font-bold leading-none tabular-nums ${a.points < 0 ? 'text-red-alliance-text' : 'text-accent-text'}`}
              >
                {signed(a.points)}
              </span>
            }
          />
        );
      })}
    </div>
  );
}
