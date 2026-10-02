import { DateBlock } from '@/components/DateBlock';
import { StatusBadge } from '@/components/StatusBadge';
import { Row } from '@/components/ui/Row';
import { formatDateRange, ordinal } from '@/lib/format';
import type { RoundStatus } from '@/lib/rounds/status';

export type EventListRound = {
  id: string;
  eventName: string;
  startDate: string;
  endDate: string;
  status: RoundStatus;
  /** The viewer's rank at this event, or null when they have none (not drafted, signed out). */
  myRank: number | null;
};

/** The Standings "Events" list (spec §6.3): one linked row per round, in the order given. */
export function EventList({ slug, rounds }: { slug: string; rounds: EventListRound[] }) {
  return (
    <div>
      {rounds.map((round) => (
        <Row
          key={round.id}
          href={`/l/${encodeURIComponent(slug)}/r/${round.id}`}
          leading={<DateBlock date={round.startDate} />}
          title={round.eventName}
          subtitle={`${formatDateRange(round.startDate, round.endDate)}${round.myRank !== null ? ` · You: ${ordinal(round.myRank)}` : ''}`}
          trailing={<StatusBadge status={round.status} />}
        />
      ))}
    </div>
  );
}
