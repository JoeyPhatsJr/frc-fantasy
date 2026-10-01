'use client';

import { useState } from 'react';
import { BumperPlate } from '@/components/ui/BumperPlate';
import { Button } from '@/components/ui/Button';
import { Check, Plus } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { PoolFootnote, PoolStatCells } from '@/components/pool/PoolStats';
import { TeamSheet } from '@/components/pool/TeamSheet';
import { filterSortPool, type PoolSort } from '@/lib/draft/poolView';
import type { PoolEntry } from '@/lib/pool/entries';
import { teamLabel } from '@/lib/teams';

/** Season pools can have thousands of teams; search narrows them. */
const SHOW_AT_MOST = 100;

type RowActions = {
  canDraft: boolean;
  draftLabel: string;
  readOnly: boolean;
  /** True while a save is in flight, so two quick taps can't build from the same stale queue. */
  queueDisabled: boolean;
  onDraft: (entry: PoolEntry) => void;
  onToggleQueue: (teamKey: string) => void;
};

/**
 * One pool team. Line 1: plate · nickname (up to two lines) · queue toggle · Draft. Line 2: the stats
 * (Proj or New · W-L-T · best finish · OPR / rank) across the full row width, so on a 360 px phone the
 * nickname isn't squeezed by the numbers.
 *
 * Tapping anywhere on the row opens the team sheet: the plate + name are a real button whose ::after
 * stretches over the whole row, and the queue and Draft buttons sit above it (relative z-10).
 */
function PoolRow({
  entry: e,
  queued,
  onOpen,
  ...a
}: RowActions & { entry: PoolEntry; queued: boolean; onOpen: (entry: PoolEntry) => void }) {
  const label = teamLabel(e.teamKey);
  const name = e.nickname ?? `Team ${label}`;
  return (
    <li
      className={`relative space-y-1.5 rounded-xl border border-border bg-surface px-3 py-2 ${e.available ? '' : 'opacity-50'}`}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={`Team ${label}${e.nickname ? ` ${e.nickname}` : ''}, show history`}
          onClick={() => onOpen(e)}
          className={
            'flex min-h-11 min-w-0 flex-1 cursor-pointer touch-manipulation items-center gap-3 text-left ' +
            'after:absolute after:inset-0 after:rounded-xl active:after:bg-primary/5 ' +
            'focus-visible:outline-hidden focus-visible:after:ring-2 focus-visible:after:ring-ring'
          }
        >
          <BumperPlate number={label} size="md" />
          <span className="line-clamp-2 min-w-0 break-words text-[15px] font-semibold leading-5 text-fg">{name}</span>
        </button>
        {a.readOnly ? null : (
          <div className="relative z-10 flex shrink-0 items-center gap-1">
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
          </div>
        )}
      </div>
      <PoolStatCells entry={e} />
    </li>
  );
}

export function PoolList({
  slug,
  roundId,
  entries,
  taken,
  queued,
  ...actions
}: RowActions & {
  /** The league and round, for the team sheet a row opens (SP3 Task 16). */
  slug: string;
  roundId: string;
  entries: PoolEntry[];
  taken: Set<string>;
  queued: Set<string>;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<PoolSort>('proj');
  const [availableOnly, setAvailableOnly] = useState(true);
  const [sheet, setSheet] = useState<PoolEntry | null>(null);
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
          <PoolRow key={e.teamKey} entry={e} queued={queued.has(e.teamKey)} onOpen={setSheet} {...actions} />
        ))}
      </ul>
      {rows.length > SHOW_AT_MOST ? (
        <p className="text-sm text-fg-muted">
          Showing {SHOW_AT_MOST} of {rows.length}. Search to find more.
        </p>
      ) : null}
      <PoolFootnote />
      {sheet ? (
        <TeamSheet
          slug={slug}
          roundId={roundId}
          teamKey={sheet.teamKey}
          nickname={sheet.nickname}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </div>
  );
}
