'use client';

import { useState } from 'react';
import { Row } from '@/components/ui/Row';
import { Sheet } from '@/components/ui/Sheet';
import { ChevronDown } from '@/components/ui/icons';

export type SwitcherLeague = { slug: string; name: string };

type ViewProps = { leagues: SwitcherLeague[]; open: boolean; onOpen: () => void; onClose: () => void };

/** The "Switch ▾" chip and its sheet of the viewer's other leagues, with no state. */
export function LeagueSwitcherView({ leagues, open, onOpen, onClose }: ViewProps) {
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onOpen}
        className="flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-full border border-on-band/30 px-3 text-[13px] font-semibold text-on-band hover:bg-on-band/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        Switch
        <ChevronDown className="size-4" />
      </button>
      <Sheet open={open} onClose={onClose} title="Your leagues">
        {/* Tapping a league closes the sheet as the page changes underneath it. */}
        <div className="-mx-4 border-t border-border" onClick={onClose}>
          {leagues.map((l) => (
            <Row key={l.slug} href={`/l/${encodeURIComponent(l.slug)}`} title={l.name} />
          ))}
          <Row href="/leagues" title="All leagues" />
        </div>
      </Sheet>
    </>
  );
}

/** League header, signed-in members with another league (spec §5.3). */
export function LeagueSwitcher({ leagues }: { leagues: SwitcherLeague[] }) {
  const [open, setOpen] = useState(false);
  return <LeagueSwitcherView leagues={leagues} open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} />;
}
