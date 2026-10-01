'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { PoolEntry } from '@/lib/pool/entries';
import { teamLabel } from '@/lib/teams';

/** §7.6: "Draft 341 · Proj 38.2?" — or, for a commissioner picking for someone, "Pick 341 for Mom?". */
export function confirmText(entry: PoolEntry, forName: string | null): string {
  const label = teamLabel(entry.teamKey);
  if (forName) return `Pick ${label} for ${forName}?`;
  return entry.proj === null ? `Draft ${label}?` : `Draft ${label} · Proj ${entry.proj.toFixed(1)}?`;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Where Tab (or Shift+Tab when `backwards`) moves focus inside the sheet: wraps at either end, and comes
 * back in from outside. `current` is the focused element's index (-1 = outside); -1 = nothing to focus.
 */
export function trappedFocusIndex(current: number, count: number, backwards: boolean): number {
  if (count === 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return (current + (backwards ? count - 1 : 1)) % count;
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
  const sheet = useRef<HTMLDivElement>(null);
  // Read during the first render, before autoFocus moves focus into the sheet: the button that opened it.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));

  // Focus starts inside the sheet and goes back to the opener when the sheet closes.
  useEffect(() => {
    const el = sheet.current;
    if (el && !el.contains(document.activeElement)) {
      const nodes = el.querySelectorAll<HTMLElement>(FOCUSABLE);
      nodes[nodes.length - 1]?.focus();
    }
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [opener]);

  // Escape closes the sheet like a tap outside it, unless the pick is already on its way.
  // Tab and Shift+Tab stay inside the sheet instead of reaching the page behind the scrim.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !busy) onCancel();
      if (ev.key === 'Tab' && sheet.current) {
        const nodes = [...sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const next = trappedFocusIndex(nodes.indexOf(document.activeElement as HTMLElement), nodes.length, ev.shiftKey);
        ev.preventDefault();
        nodes[next]?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={busy ? undefined : onCancel}>
      <div
        ref={sheet}
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
