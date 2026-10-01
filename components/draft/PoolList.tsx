'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { BumperPlate } from '@/components/ui/BumperPlate';
import { Button } from '@/components/ui/Button';
import { Check, Plus } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { filterSortPool, type PoolSort } from '@/lib/draft/poolView';
import type { PoolEntry } from '@/lib/pool/entries';
import { teamLabel } from '@/lib/teams';

/** Season pools can have thousands of teams; search narrows them. */
const SHOW_AT_MOST = 100;

const FINISH: Record<NonNullable<PoolEntry['bestFinish']>, string> = {
  winner: 'Winner',
  finalist: 'Finalist',
  captain: 'Captain',
  picked: 'Picked',
};

function statsLine(e: PoolEntry): string {
  const parts: string[] = [];
  if (e.record) parts.push(e.record.join('-'));
  if (e.bestFinish) parts.push(FINISH[e.bestFinish]);
  if (e.opr !== null) parts.push(`OPR ${e.opr.toFixed(1)}`);
  if (e.rank !== null) parts.push(`Rank ${e.rank}`);
  return parts.length > 0 ? parts.join(' · ') : 'No stats yet';
}

type RowActions = {
  canDraft: boolean;
  draftLabel: string;
  readOnly: boolean;
  /** True while a save is in flight, so two quick taps can't build from the same stale queue. */
  queueDisabled: boolean;
  onDraft: (entry: PoolEntry) => void;
  onToggleQueue: (teamKey: string) => void;
};

/** One pool team: plate · name and stats · Proj (or New) · queue toggle · Draft. */
function PoolRow({ entry: e, queued, ...a }: RowActions & { entry: PoolEntry; queued: boolean }) {
  const label = teamLabel(e.teamKey);
  return (
    <li
      className={`flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2 ${e.available ? '' : 'opacity-50'}`}
    >
      <BumperPlate number={label} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-fg">{e.nickname ?? `Team ${label}`}</p>
        <p className="truncate text-[13px] leading-[18px] text-fg-muted">{statsLine(e)}</p>
      </div>
      {e.proj === null ? (
        <Badge tone="neutral">New</Badge>
      ) : (
        <span className="shrink-0 font-display text-[17px] font-bold text-fg tabular-nums">
          Proj {e.proj.toFixed(1)}
        </span>
      )}
      {a.readOnly ? null : (
        <>
          <Button
            size="icon"
            variant="ghost"
            aria-label={queued ? `Remove ${label} from queue` : `Add ${label} to queue`}
            aria-pressed={queued}
            disabled={a.queueDisabled}
            onClick={() => a.onToggleQueue(e.teamKey)}
          >
            {queued ? <Check className="size-5" /> : <Plus className="size-5" />}
          </Button>
          <Button size="sm" disabled={!a.canDraft || !e.available} onClick={() => a.onDraft(e)}>
            {a.draftLabel}
          </Button>
        </>
      )}
    </li>
  );
}

export function PoolList({
  entries,
  taken,
  queued,
  ...actions
}: RowActions & {
  entries: PoolEntry[];
  taken: Set<string>;
  queued: Set<string>;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<PoolSort>('proj');
  const [availableOnly, setAvailableOnly] = useState(true);
  const rows = filterSortPool(entries, { query, sort, availableOnly, taken });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Input
          label="Search teams"
          inputMode="search"
          placeholder="Number or name"
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
        />
        <Select label="Sort" value={sort} onChange={(ev) => setSort(ev.target.value as PoolSort)}>
          <option value="proj">Proj</option>
          <option value="opr">OPR</option>
          <option value="number">Number</option>
        </Select>
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[15px] text-fg">
        <input
          type="checkbox"
          className="size-5 accent-primary-fill"
          checked={availableOnly}
          onChange={(ev) => setAvailableOnly(ev.target.checked)}
        />
        Available only
      </label>

      {rows.length === 0 ? <p className="text-sm text-fg-muted">No teams match.</p> : null}
      <ul className="space-y-2">
        {rows.slice(0, SHOW_AT_MOST).map((e) => (
          <PoolRow key={e.teamKey} entry={e} queued={queued.has(e.teamKey)} {...actions} />
        ))}
      </ul>
      {rows.length > SHOW_AT_MOST ? (
        <p className="text-sm text-fg-muted">
          Showing {SHOW_AT_MOST} of {rows.length}. Search to find more.
        </p>
      ) : null}
      <p className="text-[13px] text-fg-muted">Proj. uses standard scoring.</p>
    </div>
  );
}
