import { Alert } from '@/components/ui/Alert';
import { RefreshCw } from '@/components/ui/icons';
import { freshnessText } from '@/lib/format';

export function Freshness({
  fetchedAt,
  stale,
  now,
}: {
  fetchedAt: string | null;
  stale: boolean;
  now: Date;
}) {
  const message = freshnessText(fetchedAt, stale, now);
  if (stale) return <Alert tone="warning">{message}</Alert>;
  return (
    <p className="flex items-center gap-1.5 text-sm text-fg-muted">
      <RefreshCw className="size-3.5 shrink-0" />
      {message}
    </p>
  );
}
