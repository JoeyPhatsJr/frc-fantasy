'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import type { PoolEntry } from '@/lib/pool/entries';
import { teamLabel } from '@/lib/teams';

/** §7.6: "Draft 341 · Proj 38.2?" — or, for a commissioner picking for someone, "Pick 341 for Mom?". */
export function confirmText(entry: PoolEntry, forName: string | null): string {
  const label = teamLabel(entry.teamKey);
  if (forName) return `Pick ${label} for ${forName}?`;
  return entry.proj === null ? `Draft ${label}?` : `Draft ${label} · Proj ${entry.proj.toFixed(1)}?`;
}

export function ConfirmSheet({
  entry,
  forName,
  busy,
  onConfirm,
  onCancel,
}: {
  entry: PoolEntry;
  forName: string | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Escape closes the sheet like a tap outside it, unless the pick is already on its way.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={busy ? undefined : onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-pick-title"
        className="w-full space-y-4 rounded-t-card bg-surface px-4 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <p id="confirm-pick-title" className="font-display text-[22px] font-bold leading-[26px] text-fg">
          {confirmText(entry, forName)}
        </p>
        {entry.nickname ? <p className="text-[15px] text-fg-muted">{entry.nickname}</p> : null}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} busy={busy} autoFocus>
            {forName ? 'Pick' : 'Draft'}
          </Button>
        </div>
      </div>
    </div>
  );
}
