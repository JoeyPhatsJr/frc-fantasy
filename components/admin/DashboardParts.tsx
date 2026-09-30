'use client';

import { useState, type ReactNode } from 'react';
import { INPUT } from '@/components/admin/AdminGate';
import { DateBlock } from '@/components/DateBlock';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Plus, Trash2 } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import type { AdminPlayer, EventLookup } from '@/lib/api/types';
import { formatDateRange } from '@/lib/format';

// Pieces of the commissioner dashboard that hold their own text-box state.
// The dashboard gives RenameLeague and PlayerRow a `key` that includes the name: when a rename succeeds and
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
  return (
    <section>
      <Card title="League name">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(value);
          }}
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={80}
            required
            aria-label="League name"
            className={`${INPUT} flex-1`}
          />
          <Button
            type="submit"
            variant="secondary"
            busy={saving}
            disabled={busy || value.trim() === '' || value.trim() === name}
          >
            Rename
          </Button>
        </form>
      </Card>
    </section>
  );
}

export function PlayerRow({
  player,
  busy,
  pending,
  onRename,
  onRemove,
}: {
  player: AdminPlayer;
  busy: boolean;
  /** Which of this row's actions is running, if any. */
  pending: 'rename' | 'remove' | null;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const [value, setValue] = useState(player.name);
  return (
    <li className="space-y-1 py-2">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onRename(value);
        }}
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={40}
          required
          aria-label={`Name for ${player.name}`}
          className={`${INPUT} flex-1`}
        />
        <Button
          type="submit"
          variant="secondary"
          className="shrink-0"
          busy={pending === 'rename'}
          disabled={busy || value.trim() === '' || value.trim() === player.name}
        >
          Rename
        </Button>
        <Button
          type="button"
          variant="danger"
          size="icon"
          busy={pending === 'remove'}
          disabled={busy || player.inUse}
          aria-label={`Remove ${player.name}`}
          onClick={onRemove}
        >
          {pending === 'remove' ? null : <Trash2 className="size-5" />}
        </Button>
      </form>
      {player.inUse ? (
        <p className="text-[13px] leading-[18px] text-fg-muted">
          Can&apos;t be removed: this player is in a draft order or has picks or adjustments. Renaming is fine.
        </p>
      ) : null}
    </li>
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

export function AddForm({
  label,
  placeholder,
  maxLength,
  button,
  busy,
  saving,
  onAdd,
}: {
  label: string;
  placeholder: string;
  maxLength: number;
  button: string;
  busy: boolean;
  saving: boolean;
  /** Resolves to true when the add worked; the box is cleared only then, so a typo can be fixed in place. */
  onAdd: (value: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState('');
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onAdd(value)) setValue('');
      }}
    >
      <Input
        label={label}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={maxLength}
        required
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect="off"
        className="min-w-0 flex-1"
      />
      <Button type="submit" busy={saving} disabled={busy || value.trim() === ''} className="shrink-0">
        {saving ? null : <Plus className="size-4 shrink-0" />}
        {button}
      </Button>
    </form>
  );
}

/**
 * "Add a round by event key": Check looks the event up on TBA first and shows its name and dates
 * (spec §5.4), and only then offers "Add this round". Typing a different key clears the preview.
 */
export function AddRoundForm({
  busy,
  checking,
  saving,
  onCheck,
  onAdd,
}: {
  busy: boolean;
  checking: boolean;
  saving: boolean;
  /** Resolves to the look-up, or null when it failed (the dashboard shows the error). */
  onCheck: (eventKey: string) => Promise<EventLookup | null>;
  /** Resolves to true when the round was added; the box and preview are cleared only then. */
  onAdd: (eventKey: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState('');
  const [preview, setPreview] = useState<EventLookup | null>(null);
  return (
    <div className="space-y-3">
      <form
        className="flex items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setPreview(null);
          setPreview(await onCheck(value));
        }}
      >
        <Input
          label="Add a round by event key"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setPreview(null);
          }}
          maxLength={40}
          required
          placeholder="2026parr"
          autoCapitalize="none"
          autoCorrect="off"
          className="min-w-0 flex-1"
        />
        <Button
          type="submit"
          variant="secondary"
          busy={checking}
          disabled={busy || value.trim() === ''}
          className="shrink-0"
        >
          Check
        </Button>
      </form>
      <div aria-live="polite">
        {preview?.found ? (
          <div className="space-y-3 rounded-xl border border-border p-3">
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
                    setValue('');
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
          <p className="rounded-xl border border-border bg-surface-2 p-3 text-sm font-medium text-fg">
            Not on The Blue Alliance yet — try again in a few days.
          </p>
        ) : null}
      </div>
    </div>
  );
}
