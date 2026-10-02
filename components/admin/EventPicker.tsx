'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Row } from '@/components/ui/Row';
import { Section } from '@/components/ui/Section';
import { parseEventInput } from '@/lib/admin/eventInput';
import { formatDateRange } from '@/lib/format';

export type UpcomingEvent = { key: string; name: string; startDate: string; endDate: string };

/**
 * "Add an event" (spec §7.1): upcoming TBA events to tap, plus "Other event" for a pasted TBA link
 * or an event key. Either way `onPick` gets a bare key, and the dashboard's check → "Found" → add
 * flow takes it from there.
 */
export function EventPicker({
  upcoming,
  onPick,
  busy,
  checking = false,
  onEdit,
}: {
  upcoming: UpcomingEvent[];
  onPick: (eventKey: string) => void;
  busy: boolean;
  /** A look-up is running; the control that started it shows the spinner. */
  checking?: boolean;
  /** The Other event box changed (the dashboard clears a stale "Found" preview). */
  onEdit?: () => void;
}) {
  const [value, setValue] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const pick = (key: string, from: string) => {
    setPicked(from);
    onPick(key);
  };
  return (
    <Section label="Add an event">
      {upcoming.slice(0, 6).map((e) => (
        <Row
          key={e.key}
          title={e.name}
          subtitle={formatDateRange(e.startDate, e.endDate)}
          trailing={
            <Button
              type="button"
              size="sm"
              aria-label={`Add ${e.name}`}
              busy={checking && picked === e.key}
              disabled={busy}
              onClick={() => pick(e.key, e.key)}
            >
              Add
            </Button>
          }
        />
      ))}
      <form
        className="space-y-2 px-4 py-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          pick(parseEventInput(value), '#other');
        }}
      >
        <p className="text-[15px] font-semibold text-fg">Other event</p>
        <div className="flex items-end gap-2">
          <Input
            label="TBA link or event code (like 2025parr)"
            value={value}
            onChange={(ev) => {
              setValue(ev.target.value);
              onEdit?.();
            }}
            maxLength={200}
            required
            placeholder="2026parr"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            className="min-w-0 flex-1"
          />
          <Button
            type="submit"
            variant="secondary"
            busy={checking && picked === '#other'}
            disabled={busy || value.trim() === ''}
            className="shrink-0"
          >
            Check
          </Button>
        </div>
      </form>
    </Section>
  );
}
