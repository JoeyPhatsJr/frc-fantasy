import { ChevronLeft } from '@/components/ui/icons';
import { signed } from '@/lib/format';
import type { Line, PlayerRoundScore } from '@/lib/scoring/types';
import { teamLabel } from '@/lib/teams';

/** First character of the name, for the avatar circle. Array.from keeps emoji whole. */
function initial(name: string): string {
  return (Array.from(name.trim())[0] ?? '?').toUpperCase();
}

/** Dark gold for gains, red for losses (both ≥ 4.5:1 on white). */
function pointsTone(points: number): string {
  return points < 0 ? 'text-red-alliance-text' : 'text-accent-text';
}

/**
 * One breakdown line: label left, points right. The hidden arrow keeps the text
 * identical to lineText() ("Qual record 7-2-0 → +21") for screen readers and copy/paste.
 */
function LineItem({ line }: { line: Line }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="min-w-0 break-words text-fg">{line.label}</span>
      <span className="sr-only"> → </span>
      <span className={`shrink-0 font-semibold tabular-nums ${pointsTone(line.points)}`}>{signed(line.points)}</span>
    </li>
  );
}

export function RosterList({
  scores,
  teamNames,
  draftInProgress,
}: {
  scores: PlayerRoundScore[];
  teamNames: Record<string, string>;
  draftInProgress: boolean;
}) {
  if (scores.length === 0) return <p className="text-sm text-fg-muted">No players in this round yet.</p>;
  return (
    <div className="space-y-2">
      {scores.map((player) => (
        <details key={player.playerId} className="group rounded-xl border border-border bg-surface">
          <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-xl px-3 py-2 motion-safe:transition-colors duration-200 hover:bg-surface-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring group-open:rounded-b-none [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-fill font-display text-lg font-bold text-on-primary"
            >
              {initial(player.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-fg">{player.name}</span>
              <span className="block text-sm text-fg-muted">
                {player.teams.length === 0 && draftInProgress
                  ? 'draft in progress'
                  : `${player.teams.length} ${player.teams.length === 1 ? 'team' : 'teams'}`}
              </span>
            </span>
            <span className="shrink-0 font-display text-2xl font-bold leading-none text-primary tabular-nums">
              {player.total}
            </span>
            <ChevronLeft className="size-5 shrink-0 -rotate-90 text-fg-muted motion-safe:transition-transform duration-200 group-open:rotate-90" />
          </summary>

          <div className="space-y-3 border-t border-border px-3 py-3">
            {/* The summary truncates long names. Here the full name is shown (spec §8.5). */}
            <p className="break-words text-sm font-semibold text-fg">{player.name}</p>

            {player.teams.map((team) => {
              // Zero-point lines are hidden (spec §7.9).
              const lines = team.lines.filter((l) => l.points !== 0);
              const nickname = teamNames[team.teamKey];
              return (
                <div key={team.teamKey} className="rounded-lg border border-border px-3 py-2">
                  <p className="flex items-center gap-2">
                    <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 font-display text-lg font-bold leading-tight text-primary tabular-nums">
                      {teamLabel(team.teamKey)}
                    </span>{' '}
                    <span className="min-w-0 flex-1 break-words font-medium text-fg">
                      {nickname ?? ''}
                      <span className="sr-only"> — </span>
                    </span>
                    <span className="shrink-0 font-display text-lg font-bold text-fg tabular-nums">
                      {team.total} pts
                    </span>
                  </p>
                  {lines.length === 0 ? (
                    <p className="mt-1 text-sm text-fg-muted">No points yet</p>
                  ) : (
                    <ul className="mt-1 divide-y divide-border">
                      {lines.map((line, i) => (
                        <LineItem key={i} line={line} />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}

            {player.adjustments.length > 0 ? (
              <div className="rounded-lg border border-border px-3 py-2">
                <p className="font-display text-lg font-bold uppercase tracking-wide text-fg">Player adjustments</p>
                <ul className="mt-1 divide-y divide-border">
                  {player.adjustments.map((line, i) => (
                    <LineItem key={i} line={line} />
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}
