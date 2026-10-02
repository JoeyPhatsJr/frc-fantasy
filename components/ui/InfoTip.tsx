'use client';

import { useId, useState } from 'react';
import { Info } from '@/components/ui/icons';
import { GLOSSARY, type GlossaryKey } from '@/lib/glossary';

/** ⓘ next to a term: tap to show its one-line explainer inline (spec §4.6). */
export function InfoTip({ term }: { term: GlossaryKey }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { label, short } = GLOSSARY[term];
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        aria-label={`What is ${label}?`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="-my-3 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-fg-muted hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="size-4" />
      </button>
      {open ? (
        <span id={id} role="note" className="mt-1 block max-w-xs text-[13px] font-normal leading-5 text-fg-muted">
          {short}
        </span>
      ) : null}
    </span>
  );
}
