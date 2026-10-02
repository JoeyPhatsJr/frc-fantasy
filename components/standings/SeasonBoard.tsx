import { StatusBadge } from '@/components/StatusBadge';
import { Points, RankNumeral, Row } from '@/components/ui/Row';
import type { RoundStatus } from '@/lib/rounds/status';
import type { SeasonRow } from '@/lib/scoring/types';

export type SeasonBoardRound = { id: string; eventName: string; status: RoundStatus };

const DONE: ReadonlySet<RoundStatus> = new Set(['final', 'awaiting_final']);

/**
 * The Standings strip title (spec §6.3): "{n} events · {k} to go", "No events yet", and once nothing is
 * left to play, "Season over" only when every round is final — before that, results can still change.
 */
export function seasonProgress(rounds: { status: RoundStatus }[]): string {
  if (rounds.length === 0) return 'No events yet';
  const left = rounds.filter((r) => !DONE.has(r.status)).length;
  if (left > 0) return `${rounds.length} ${rounds.length === 1 ? 'event' : 'events'} · ${left} to go`;
  return rounds.every((r) => r.status === 'final') ? 'Season over' : 'All events done · waiting on final results';
}

function Breakdown({ perRound, rounds }: { perRound: number[]; rounds: SeasonBoardRound[] }) {
  return (
    <ul className="divide-y divide-border text-[13px]">
      {rounds.map((round, i) => (
        <li key={round.id} className="flex min-h-9 items-center gap-2 py-1.5">
          <span className="min-w-0 flex-1 truncate text-fg" title={round.eventName}>{round.eventName}</span>
          {round.status === 'final' || round.status === 'live' ? <StatusBadge status={round.status} /> : null}
          <span className="shrink-0 tabular-nums text-fg-muted">
            <span className="sr-only"> · </span>
            {perRound[i] ?? 0} pts
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The season leaderboard (spec §6.3): one row per player; expanded = their points at each event, by
 * name and in date order. The viewer's own row is highlighted and open by default.
 */
export function SeasonBoard({ standings, rounds, meId }: { standings: SeasonRow[]; rounds: SeasonBoardRound[]; meId: string | null }) {
  return (
    <div>
      {standings.map((row) => {
        const isMe = meId !== null && row.playerId === meId;
        return (
          <Row
            key={row.playerId}
            leading={<RankNumeral rank={row.rank} />}
            title={`${row.name}${isMe ? ' (you)' : ''}`}
            trailing={<Points value={row.total} />}
            highlight={isMe}
            defaultOpen={isMe}
            expanded={rounds.length > 0 ? <Breakdown perRound={row.perRound} rounds={rounds} /> : undefined}
          />
        );
      })}
    </div>
  );
}
