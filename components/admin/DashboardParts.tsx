'use client';

import { useState } from 'react';
import { INPUT } from '@/components/admin/AdminGate';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Plus, Trash2 } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import type { AdminPlayer } from '@/lib/api/types';

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
    <li className="space-y-2 rounded-xl border border-border bg-surface p-3">
      <form
        className="flex flex-col gap-2 sm:flex-row"
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
          className={`${INPUT} w-full sm:flex-1`}
        />
        <div className="flex gap-2">
          <Button
            type="submit"
            variant="secondary"
            className="flex-1 sm:flex-none"
            busy={pending === 'rename'}
            disabled={busy || value.trim() === '' || value.trim() === player.name}
          >
            Rename
          </Button>
          <Button
            type="button"
            variant="danger"
            className="flex-1 sm:flex-none"
            busy={pending === 'remove'}
            disabled={busy || player.inUse}
            onClick={onRemove}
          >
            {pending === 'remove' ? null : <Trash2 className="size-4 shrink-0" />}
            Remove
          </Button>
        </div>
      </form>
      {player.inUse ? (
        <p className="text-xs text-fg-muted">
          Can&apos;t be removed: this player is in a draft order or has picks or adjustments. Renaming is fine.
        </p>
      ) : null}
    </li>
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
