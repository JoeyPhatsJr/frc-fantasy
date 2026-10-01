'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Plus } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';

export type ManualRoundInput = { name: string; startDate: string; endDate: string };

/** "Add round → Manual event" (spec §5.3): for events that aren't on The Blue Alliance. */
export function AddManualRoundForm({
  busy,
  saving,
  onAdd,
}: {
  busy: boolean;
  saving: boolean;
  /** Resolves to true when the round was added; the form clears only then. */
  onAdd: (input: ManualRoundInput) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onAdd({ name: name.trim(), startDate, endDate: endDate || startDate })) {
          setName('');
          setStartDate('');
          setEndDate('');
        }
      }}
    >
      <Input label="Event name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder="Garage Games" />
      <div className="grid grid-cols-2 gap-2">
        <Input label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        <Input
          label="End date"
          type="date"
          value={endDate}
          min={startDate || undefined}
          onChange={(e) => setEndDate(e.target.value)}
          hint="Blank = same day"
        />
      </div>
      <Button type="submit" variant="accent" busy={saving} disabled={busy || name.trim() === '' || startDate === ''}>
        {saving ? null : <Plus className="size-4 shrink-0" />}
        Add manual event
      </Button>
      <p className="text-[13px] leading-[18px] text-fg-muted">
        Manual events aren&apos;t on The Blue Alliance. You add the teams, then type in their results afterwards.
      </p>
    </form>
  );
}
