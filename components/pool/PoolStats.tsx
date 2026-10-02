import { Badge } from '@/components/ui/Badge';
import type { PoolEntry } from '@/lib/pool/entries';
import { GLOSSARY } from '@/lib/glossary';
import { BEST_FINISH_LABEL, formatOprRank, formatProj, formatRecord, POOL_FOOTNOTE } from '@/lib/pool/format';

/** Shown instead of a projection for teams with no results in the last two seasons. */
export function NewChip() {
  return <Badge tone="neutral">New</Badge>;
}

/**
 * The stat line of a pool row (spec §6.3): Projected (or New) · W-L-T · best finish · Robot rating (OPR) / rank.
 * Labels come from the glossary (UX §4.7).
 * It wraps onto a second line instead of scrolling sideways on a 360 px phone.
 */
export function PoolStatCells({ entry }: { entry: PoolEntry }) {
  return (
    <div
      data-pool-stats
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-[18px] text-fg-muted"
    >
      {entry.proj === null ? (
        <NewChip />
      ) : (
        <span className="whitespace-nowrap">
          <span className="font-semibold">{GLOSSARY.proj.label}</span>{' '}
          <span className="font-display text-[17px] font-bold text-fg tabular-nums">{formatProj(entry.proj)}</span>
        </span>
      )}
      {entry.record ? <span className="whitespace-nowrap tabular-nums">{formatRecord(entry.record)}</span> : null}
      {entry.bestFinish ? (
        // Gold is the leader colour (design system), so only an event win gets it.
        <Badge tone={entry.bestFinish === 'winner' ? 'warning' : 'neutral'}>{BEST_FINISH_LABEL[entry.bestFinish]}</Badge>
      ) : null}
      {entry.opr !== null || entry.rank !== null ? (
        <span className="whitespace-nowrap tabular-nums">{formatOprRank(entry.opr, entry.rank, GLOSSARY.opr.label)}</span>
      ) : null}
    </div>
  );
}

export function PoolFootnote() {
  return <p className="text-[13px] leading-[18px] text-fg-muted">{POOL_FOOTNOTE}</p>;
}
