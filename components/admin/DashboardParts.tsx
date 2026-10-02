'use client';

import { useId, useState, type ReactNode } from 'react';
import { INPUT } from '@/components/admin/AdminGate';
import { EventPicker, type UpcomingEvent } from '@/components/admin/EventPicker';
import { DateBlock } from '@/components/DateBlock';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/Button';
import { ChevronDown, Plus } from '@/components/ui/icons';
import { Row } from '@/components/ui/Row';
import type { AdminRoundSummary, EventLookup } from '@/lib/api/types';
import type { Visibility } from '@/lib/db/types';
import { autoAddedNote } from '@/lib/follow/input';
import { formatDateRange } from '@/lib/format';

// Pieces of the commissioner dashboard that hold their own text-box state.
// The dashboard gives RenameLeague a `key` that includes the name: when a rename succeeds and
// the reloaded name changes, React rebuilds the piece, so its box never shows a stale value.

export function RenameLeague({
  name,
  busy,
  saving,
  onSave,
}: {
  name: string;
  busy: boolean;
  saving: boolean;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(name);
  const id = useId();
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value);
      }}
    >
      <label htmlFor={id} className="text-sm font-semibold text-fg">
        League name
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          name="leagueName"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={80}
          required
          className={`${INPUT} min-w-0 flex-1`}
        />
        <Button
          type="submit"
          variant="secondary"
          busy={saving}
          disabled={busy || value.trim() === '' || value.trim() === name}
          className="shrink-0"
        >
          Rename
        </Button>
      </div>
    </form>
  );
}

/** "Who can see the league?" (spec §7.1 Settings; moved here from the Members card). */
export function VisibilityField({
  visibility,
  busy,
  onChange,
}: {
  visibility: Visibility;
  busy: boolean;
  onChange: (v: Visibility) => void;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-sm font-semibold text-fg">Who can see the league?</legend>
      {(
        [
          ['link', 'Anyone with the link'],
          ['members', 'Members only'],
        ] as const
      ).map(([value, label]) => (
        <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="radio"
            name="visibility"
            checked={visibility === value}
            disabled={busy}
            onChange={() => onChange(value)}
            className="size-4"
          />
          <span className="text-fg">{label}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * The league's rounds on the admin page (spec §7.1): one row per round, linking to its round admin.
 * There is no Delete here; deleting an event lives in round admin.
 */
export function RoundRows({ slug, rounds, follows }: { slug: string; rounds: AdminRoundSummary[]; follows: number[] }) {
  return (
    <>
      {rounds.map((round) => (
        <Row
          key={round.id}
          href={`/l/${slug}/admin/r/${round.id}`}
          leading={<DateBlock date={round.startDate} />}
          title={round.eventName}
          subtitle={[
            round.totalPicks === 0 ? 'Draft not set up' : `${round.pickCount} of ${round.totalPicks} picks`,
            ...(round.autoAdded ? [autoAddedNote(follows)] : []),
          ].join(' · ')}
          trailing={
            <>
              <StatusBadge status={round.status} />
              <ChevronDown className="size-4 shrink-0 -rotate-90 text-fg-muted" />
            </>
          }
        />
      ))}
    </>
  );
}

/**
 * The date-block row the public standings page uses for rounds: a calendar tile, the event name,
 * then muted 13px lines (date range, event key...). `trailing` sits at the right (a status badge).
 */
export function EventRow({
  startDate,
  title,
  lines,
  trailing,
}: {
  startDate: string;
  title: ReactNode;
  lines: ReactNode[];
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <DateBlock date={startDate} />
      <div className="min-w-0 flex-1">
        <p className="break-words text-[17px] font-semibold leading-6 text-fg">{title}</p>
        {lines.map((line, i) => (
          <p key={i} className="break-words text-[13px] leading-[18px] text-fg-muted tabular-nums">
            {line}
          </p>
        ))}
      </div>
      {trailing}
    </div>
  );
}

/**
 * "Add an event": the EventPicker (upcoming TBA events + "Other event") feeding one check → "Found"
 * preview → "Add this round" flow (spec §5.4, §7.1). Picking an upcoming event and checking a typed
 * key or pasted TBA link both go through `check`; editing the box clears a stale preview.
 */
export function AddRoundForm({
  upcoming,
  busy,
  checking,
  saving,
  onCheck,
  onAdd,
}: {
  upcoming: UpcomingEvent[];
  busy: boolean;
  checking: boolean;
  saving: boolean;
  /** Resolves to the look-up, or null when it failed (the dashboard shows the error). */
  onCheck: (eventKey: string) => Promise<EventLookup | null>;
  /** Resolves to true when the round was added; the box and preview are cleared only then. */
  onAdd: (eventKey: string) => Promise<boolean>;
}) {
  const [preview, setPreview] = useState<EventLookup | null>(null);
  /** Bumped after an add, so the picker remounts with an empty box. */
  const [resets, setResets] = useState(0);
  const check = async (eventKey: string) => {
    setPreview(null);
    setPreview(await onCheck(eventKey));
  };
  return (
    <div>
      <EventPicker
        key={resets}
        upcoming={upcoming}
        busy={busy}
        checking={checking}
        onPick={(key) => void check(key)}
        onEdit={() => setPreview(null)}
      />
      <div aria-live="polite" className="px-4">
        {preview?.found ? (
          <div className="mb-4 space-y-3 rounded-xl border border-border p-3">
            <EventRow
              startDate={preview.startDate}
              title={`Found: ${preview.name}`}
              lines={[formatDateRange(preview.startDate, preview.endDate), preview.eventKey]}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-15">
              <Button
                type="button"
                variant="accent"
                busy={saving}
                disabled={busy || preview.alreadyInLeague}
                onClick={async () => {
                  if (await onAdd(preview.eventKey)) {
                    setResets((n) => n + 1);
                    setPreview(null);
                  }
                }}
              >
                {saving ? null : <Plus className="size-4 shrink-0" />}
                Add this round
              </Button>
              {preview.alreadyInLeague ? (
                <p className="text-sm font-medium text-fg-muted">Already in this league</p>
              ) : null}
            </div>
          </div>
        ) : preview ? (
          <p className="mb-4 rounded-xl border border-border bg-surface-2 p-3 text-sm font-medium text-fg">
            Not on The Blue Alliance yet — try again in a few days.
          </p>
        ) : null}
      </div>
    </div>
  );
}
