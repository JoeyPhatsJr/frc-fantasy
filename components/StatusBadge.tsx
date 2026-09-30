import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { STATUS_LABEL, type RoundStatus } from '@/lib/rounds/status';

const TONE: Record<RoundStatus, BadgeTone> = {
  setup: 'drafting',
  drafting: 'drafting',
  upcoming: 'upcoming',
  live: 'live',
  awaiting_final: 'warning',
  final: 'final',
};

export function StatusBadge({ status }: { status: RoundStatus }) {
  return <Badge tone={TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
