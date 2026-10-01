'use client';

import { BumperPlate } from '@/components/ui/BumperPlate';
import { Button } from '@/components/ui/Button';
import { ArrowDown, ArrowUp, X } from '@/components/ui/icons';
import { moveItem } from '@/lib/draft';
import { teamLabel } from '@/lib/teams';

/** My draft queue (§7.6). Taken teams disappear; reordering saves the visible list. */
export function QueueList({
  queue,
  teamNames,
  taken,
  disabled,
  onChange,
}: {
  queue: string[];
  teamNames: Record<string, string>;
  taken: Set<string>;
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const visible = queue.filter((k) => !taken.has(k));
  if (visible.length === 0) {
    return (
      <p className="text-[15px] text-fg-muted">
        Your queue is empty. Add teams from the Pool tab with +. When time runs out or you&apos;re on auto-draft, the
        first available team in your queue is picked for you.
      </p>
    );
  }
  return (
    <ol className="space-y-2">
      {visible.map((teamKey, i) => {
        const label = teamLabel(teamKey);
        return (
          <li key={teamKey} className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
            <span className="w-6 text-right text-[13px] text-fg-muted tabular-nums">{i + 1}</span>
            <BumperPlate number={label} size="sm" />
            <span className="min-w-0 flex-1 truncate text-[15px] text-fg">{teamNames[teamKey] ?? `Team ${label}`}</span>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Move ${label} up`}
              disabled={disabled || i === 0}
              onClick={() => onChange(moveItem(visible, i, -1))}
            >
              <ArrowUp className="size-5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Move ${label} down`}
              disabled={disabled || i === visible.length - 1}
              onClick={() => onChange(moveItem(visible, i, 1))}
            >
              <ArrowDown className="size-5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Remove ${label}`}
              disabled={disabled}
              onClick={() => onChange(visible.filter((k) => k !== teamKey))}
            >
              <X className="size-5" />
            </Button>
          </li>
        );
      })}
    </ol>
  );
}
