import type { StripTone } from '@/components/ui/StatusStrip';
import type { RoundKind } from '@/lib/db/types';
import { formatDateRange, freshnessText, shortDate } from '@/lib/format';
import type { RoundStatus } from '@/lib/rounds/status';

export type StripInput = {
  slug: string; roundId: string; eventName: string; startDate: string; endDate: string;
  status: RoundStatus; kind: RoundKind; fetchedAt: string | null; stale: boolean; winnerName: string | null;
};
export type Strip = { tone: StripTone; title: string; detail: string | null; action: { label: string; href: string } | null };

/** What the top of the Event tab says for each round status (spec §6.5). */
export function roundStrip(i: StripInput, now: Date): Strip {
  const dates = formatDateRange(i.startDate, i.endDate);
  const fresh = i.kind === 'manual' ? 'Scores entered by the commissioner' : freshnessText(i.fetchedAt, i.stale, now);
  const draftHref = `/l/${encodeURIComponent(i.slug)}/r/${i.roundId}/draft`;
  switch (i.status) {
    case 'setup':
      return { tone: 'neutral', title: 'Draft not set up yet', detail: dates, action: null };
    case 'drafting':
      return { tone: 'drafting', title: 'Draft in progress', detail: dates, action: { label: 'Open draft room', href: draftHref } };
    case 'upcoming':
      return { tone: 'neutral', title: `Starts ${shortDate(i.startDate)}`, detail: dates, action: null };
    case 'live':
      return { tone: 'live', title: i.eventName, detail: fresh, action: null };
    case 'awaiting_final':
      return { tone: 'final', title: 'Event over · results may still change', detail: fresh, action: null };
    case 'final':
      return { tone: 'final', title: i.winnerName ? `Final · ${i.winnerName} wins` : 'Final', detail: dates, action: null };
  }
}
