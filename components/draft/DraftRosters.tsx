import { BumperPlate } from '@/components/ui/BumperPlate';
import type { DraftState } from '@/lib/draft/state';
import { teamLabel } from '@/lib/teams';

/** The Rosters tab (§7.6): each player in draft order with the teams they have so far. */
export function DraftRosters({
  order,
  picks,
  rosterSize,
  teamNames,
}: {
  order: DraftState['order'];
  picks: DraftState['picks'];
  rosterSize: number;
  teamNames: Record<string, string>;
}) {
  return (
    <ul className="space-y-3">
      {order.map((p) => {
        const mine = picks.filter((pk) => pk.playerId === p.playerId);
        return (
          <li key={p.playerId} className="rounded-xl border border-border bg-surface px-3 py-3">
            <p className="mb-2 text-[15px] font-semibold text-fg">
              {p.name}{' '}
              <span className="font-normal text-fg-muted">
                · {mine.length} of {rosterSize}
              </span>
            </p>
            {mine.length === 0 ? (
              <p className="text-sm text-fg-muted">No teams yet.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {mine.map((pk) => (
                  <li key={pk.pickNumber} className="flex items-center gap-1.5" title={teamNames[pk.teamKey]}>
                    <BumperPlate number={teamLabel(pk.teamKey)} size="sm" />
                    {pk.auto ? <span className="text-[12px] text-fg-muted">auto</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
