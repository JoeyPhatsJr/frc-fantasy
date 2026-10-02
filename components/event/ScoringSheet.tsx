'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';

type ViewProps = { lines: string[]; open: boolean; onOpen: () => void; onClose: () => void };

/** "How scoring works" and its sheet of plain-English rules, with no state. */
export function ScoringSheetView({ lines, open, onOpen, onClose }: ViewProps) {
  return (
    <>
      <Button variant="ghost" size="sm" aria-haspopup="dialog" aria-expanded={open} onClick={onOpen}>
        How scoring works
      </Button>
      <Sheet open={open} onClose={onClose} title="How scoring works">
        <ul className="space-y-2 text-[15px] text-fg">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}

/** The round's scoring config in plain words (spec §6.5), from scoringSummary(). */
export function ScoringSheet({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false);
  return <ScoringSheetView lines={lines} open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} />;
}
