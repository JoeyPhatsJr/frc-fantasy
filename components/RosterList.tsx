import { seasonEventLabel } from '@/components/event/PlayerBoard';
import { BumperPlate } from '@/components/ui/BumperPlate';
import { ChevronDown } from '@/components/ui/icons';
import { formatDateRange, signed } from '@/lib/format';
import type { Line, PlayerRoundScore } from '@/lib/scoring/types';
import type { SeasonTeamDetail } from '@/lib/season/score';
import { teamLabel } from '@/lib/teams';

/** First character of the name, for the avatar circle. Array.from keeps emoji whole. */
function initial(name: string): string {
  return (Array.from(name.trim())[0] ?? '?').toUpperCase();
}

/** Gold text for gains, red for losses (both ≥ 4.5:1 in both themes). */
function pointsTone(points: number): string {
  return points < 0 ? 'text-red-alliance-text' : 'text-accent-text';
}

/**
 * One breakdown line in a two-column list: label left, points right. The hidden arrow keeps the
 * text identical to lineText() ("Qual record 7-2-0 → +21") for screen readers and copy/paste.
 */
function LineItem({ line }: { line: Line }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1.5 text-[15px] leading-[22px]">
      <span className="min-w-0 break-words text-fg">{line.label}</span>
      <span className="sr-only"> → </span>
      <span className={`shrink-0 font-semibold tabular-nums ${pointsTone(line.points)}`}>{signed(line.points)}</span>
    </li>
  );
}

// Moved to the Event tab's PlayerBoard (UX overhaul Task 10); re-exported until RosterList is deleted.
export { seasonEventLabel };

/** Season rounds (spec §5.5): the team's season total → one row per event → that event's v1 lines. */
function SeasonBreakdown({ detail, adjustments }: { detail: SeasonTeamDetail; adjustments: Line[] }) {
  return (
    <div className="mt-2 space-y-2">
      {detail.events.length === 0 ? (
        <p className="text-[13px] leading-[18px] text-fg-muted">No events yet</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg bg-surface-2 px-3">
          {detail.events.map((e) => {
            const lines = e.lines.filter((l) => l.points !== 0);
            return (
              <li key={e.eventKey}>
                <details className="group/event">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-1.5 text-[15px] leading-[22px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 break-words text-fg">{seasonEventLabel(e)}</span>
                    <span className={`shrink-0 font-semibold tabular-nums ${pointsTone(e.total)}`}>{signed(e.total)}</span>
                  </summary>
                  {lines.length === 0 ? (
                    <p className="pb-2 text-[13px] leading-[18px] text-fg-muted">No points yet</p>
                  ) : (
                    <ul className="divide-y divide-border pb-1 pl-3">
                      {lines.map((line, i) => (
                        <LineItem key={i} line={line} />
                      ))}
                    </ul>
                  )}
                </details>
              </li>
            );
          })}
        </ul>
      )}
      {adjustments.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg bg-surface-2 px-3">
          {adjustments.map((line, i) => (
            <LineItem key={i} line={line} />
          ))}
        </ul>
      ) : null}
      {detail.next ? (
        <p className="text-[13px] leading-[18px] text-fg-muted">
          Next: {detail.next.name} · {formatDateRange(detail.next.startDate, detail.next.startDate)}
        </p>
      ) : null}
    </div>
  );
}

/** The line above the rosters. Season rosters open player → team's events → one event's lines (T15). */
export function rostersHint(season: boolean): string {
  return season
    ? 'Tap a player, then an event, to see where its points came from.'
    : 'Tap a player to see where their points came from.';
}

export function RosterList({
  scores,
  teamNames,
  draftInProgress,
  season,
}: {
  scores: PlayerRoundScore[];
  teamNames: Record<string, string>;
  draftInProgress: boolean;
  /** Season rounds only: each team expands into its per-event subtotals. */
  season?: Record<string, SeasonTeamDetail> | null;
}) {
  if (scores.length === 0) return <p className="text-sm text-fg-muted">No players in this round yet.</p>;
  return (
    <div className="space-y-2">
      {scores.map((player) => (
        <details key={player.playerId} className="group rounded-xl border border-border bg-surface">
          <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-xl px-3 py-2 motion-safe:transition-colors duration-200 hover:bg-surface-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring group-open:rounded-b-none [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-fill font-display text-[17px] font-bold text-on-primary"
            >
              {initial(player.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[17px] font-semibold leading-6 text-fg">{player.name}</span>
              <span className="block text-[13px] leading-[18px] text-fg-muted">
                {player.teams.length === 0 && draftInProgress
                  ? 'draft in progress'
                  : `${player.teams.length} ${player.teams.length === 1 ? 'team' : 'teams'}`}
              </span>
            </span>
            <span className="shrink-0 font-display text-[28px] font-bold leading-[30px] text-fg tabular-nums">
              {player.total}
            </span>
            <ChevronDown className="size-5 shrink-0 text-fg-muted motion-safe:transition-transform duration-200 group-open:rotate-180" />
          </summary>

          <div className="space-y-3 border-t border-border px-3 py-3">
            {/* The summary truncates long names. Here the full name is shown (spec §8.5). */}
            <p className="break-words text-[15px] font-semibold text-fg">{player.name}</p>

            {player.teams.length > 0 ? (
              <ul className="divide-y divide-border">
                {player.teams.map((team) => {
                  // Zero-point lines are hidden (spec §7.9).
                  const lines = team.lines.filter((l) => l.points !== 0);
                  const nickname = teamNames[team.teamKey];
                  return (
                    <li key={team.teamKey} className="py-3 first:pt-0 last:pb-0">
                      <p className="flex items-center gap-3">
                        <BumperPlate number={teamLabel(team.teamKey)} size="md" />{' '}
                        <span className="min-w-0 flex-1 break-words text-[15px] font-medium leading-[22px] text-fg">
                          {nickname ?? ''}
                          <span className="sr-only"> — </span>
                        </span>
                        <span className="shrink-0 font-display text-[22px] font-bold leading-[26px] text-fg tabular-nums">
                          {team.total} pts
                        </span>
                      </p>
                      {season?.[team.teamKey] ? (
                        <SeasonBreakdown
                          detail={season[team.teamKey]}
                          adjustments={team.lines.filter((l) => l.category === 'adjustment' && l.points !== 0)}
                        />
                      ) : lines.length === 0 ? (
                        <p className="mt-2 text-[13px] leading-[18px] text-fg-muted">No points yet</p>
                      ) : (
                        <ul className="mt-2 divide-y divide-border rounded-lg bg-surface-2 px-3">
                          {lines.map((line, i) => (
                            <LineItem key={i} line={line} />
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {player.adjustments.length > 0 ? (
              <div className="border-t border-border pt-3">
                <p className="text-[15px] font-semibold leading-[22px] text-fg">Player adjustments</p>
                <ul className="mt-2 divide-y divide-border rounded-lg bg-surface-2 px-3">
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
