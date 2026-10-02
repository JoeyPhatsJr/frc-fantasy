'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { trappedFocusIndex } from '@/components/draft/ConfirmSheet';
import { X } from '@/components/ui/icons';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Stops the page behind an open sheet from scrolling; the returned function puts the old value back. */
export function lockBodyScroll(body: { style: { overflow: string } }): () => void {
  const previous = body.style.overflow;
  body.style.overflow = 'hidden';
  return () => {
    body.style.overflow = previous;
  };
}

/** A bottom sheet on phones, a centered dialog on desktop. Traps focus, closes on Escape or backdrop tap. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    const unlockScroll = lockBodyScroll(document.body);
    const el = panel.current;
    el?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onCloseRef.current();
      if (ev.key === 'Tab' && panel.current) {
        const nodes = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const next = trappedFocusIndex(nodes.indexOf(document.activeElement as HTMLElement), nodes.length, ev.shiftKey);
        ev.preventDefault();
        nodes[next]?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      unlockScroll();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-[28rem] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={titleId} className="font-display text-[20px] font-bold leading-6 text-fg">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-2 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
