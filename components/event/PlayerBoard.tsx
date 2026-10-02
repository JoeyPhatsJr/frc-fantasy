import { BumperPlate } from '@/components/ui/BumperPlate';
import { Points, RankNumeral, Row } from '@/components/ui/Row';
import { formatDateRange, lineText, shortDate, signed } from '@/lib/format';
import type { RoundStatus } from '@/lib/rounds/status';
import type { Line, PlayerRoundScore, TeamScore } from '@/lib/scoring/types';
import type { SeasonEventScore, SeasonTeamDetail } from '@/lib/season/score';
import { teamLabel } from '@/lib/teams';

export type PlayerBoardProps = {
  scores: PlayerRoundScore[];
  meId: string | null;
  teamNames: Record<string, string>;
  status: RoundStatus;
  /** Season rounds only: teamKey -> that team's per-event breakdown. */
  season: Record<string, SeasonTeamDetail> | null;
};

export function seasonEventLabel(e: SeasonEventScore): string {
  return `${formatDateRange(e.startDate, e.endDate)} · ${e.name}`;
}

/** Zero-point lines are hidden (spec §7.9); what's left reads "Qual record 7-2-0 → +21 · …". */
function breakdown(lines: Line[]): string {
  return lines.filter((l) => l.points !== 0).map(lineText).join(' · ');
}

function TeamLine({ team, teamNames, preEvent, detail }: { team: TeamScore; teamNames: Record<string, string>; preEvent: boolean; detail: SeasonTeamDetail | null }) {
  // A season team's lines are every event's lines flattened, so only its hand-added ones are shown;
  // the per-event subtotals below carry the rest.
  const text = breakdown(detail ? team.lines.filter((l) => l.category === 'adjustment') : team.lines);
  return (
    <li className="py-2">
      <div className="flex items-center gap-3">
        <BumperPlate size="sm" number={teamLabel(team.teamKey)} />
        <span className="min-w-0 flex-1">
          {/* The plate already shows the number, so only the nickname goes here (when TBA knows it). */}
          {teamNames[team.teamKey] ? (
            <span className="block truncate text-[15px] font-medium text-fg">{teamNames[team.teamKey]}</span>
          ) : null}
          {text ? (
            <span className="block truncate text-[13px] text-fg-muted" title={text}>{text}</span>
          ) : !preEvent && !detail ? (
            <span className="block text-[13px] text-fg-muted">No points yet</span>
          ) : null}
        </span>
        <Points size="md" value={preEvent ? null : team.total} />
      </div>
      {detail ? (
        <ul className="mt-1 space-y-0.5 pl-4 text-[13px] text-fg-muted">
          {detail.events.length === 0 ? <li>No events yet</li> : null}
          {detail.events.map((e) => (
            <li key={e.eventKey} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">{seasonEventLabel(e)}</span>
              <span className="sr-only"> → </span>
              <span className="shrink-0 tabular-nums">{signed(e.total)}</span>
            </li>
          ))}
          {detail.next ? <li>Next: {detail.next.name} · {shortDate(detail.next.startDate)}</li> : null}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * The Event tab leaderboard (spec §6.5): one expandable row per player; expanded = their teams in
 * pick order with plain breakdowns. The viewer's own row is highlighted and open by default.
 */
export function PlayerBoard({ scores, meId, teamNames, status, season }: PlayerBoardProps) {
  if (scores.length === 0) return <p className="px-4 py-3 text-sm text-fg-muted">No players in this round yet.</p>;
  const preEvent = status === 'setup' || status === 'drafting' || status === 'upcoming';
  return (
    <div>
      {scores.map((score) => {
        const isMe = meId !== null && score.playerId === meId;
        return (
          <Row
            key={score.playerId}
            leading={<RankNumeral rank={score.rank} />}
            title={`${score.name}${isMe ? ' (you)' : ''}`}
            trailing={<Points value={preEvent ? null : score.total} />}
            highlight={isMe}
            defaultOpen={isMe}
            expanded={
              <>
                {score.teams.length === 0 ? (
                  <p className="py-1 text-sm text-fg-muted">No teams yet</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {score.teams.map((team) => (
                      <TeamLine
                        key={team.teamKey}
                        team={team}
                        teamNames={teamNames}
                        preEvent={preEvent}
                        detail={season ? (season[team.teamKey] ?? null) : null}
                      />
                    ))}
                  </ul>
                )}
                {/* The engine already labels these "Adjustment: {reason}" (lib/scoring/round.ts). */}
                {score.adjustments.map((line, i) => (
                  <p key={i} className="py-1 text-[13px] text-fg-muted">{lineText(line)}</p>
                ))}
              </>
            }
          />
        );
      })}
    </div>
  );
}
