'use client';

import { useState } from 'react';
import { Row } from '@/components/ui/Row';
import { Sheet } from '@/components/ui/Sheet';
import { ChevronDown, ExternalLink } from '@/components/ui/icons';
import { shortDate } from '@/lib/format';

export type SwitcherRound = { id: string; eventName: string; startDate: string };

type Props = { slug: string; currentId: string; currentName: string; rounds: SwitcherRound[]; tbaUrl: string | null };
type ViewProps = Props & { open: boolean; onOpen: () => void; onClose: () => void };

/** The "{event} ▾" chip and its sheet of the league's rounds plus the TBA link, with no state. */
export function EventSwitcherView({ slug, currentId, currentName, rounds, tbaUrl, open, onOpen, onClose }: ViewProps) {
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onOpen}
        className="flex min-h-11 max-w-full cursor-pointer items-center gap-1 truncate rounded-full border border-border px-3 text-sm font-semibold text-fg hover:bg-surface-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 truncate">{currentName}</span>
        <ChevronDown className="size-4 shrink-0" />
      </button>
      <Sheet open={open} onClose={onClose} title="Events">
        {/* Tapping an event closes the sheet as the page changes underneath it. */}
        <div className="-mx-4 border-t border-border" onClick={onClose}>
          {rounds.map((r) => (
            <Row
              key={r.id}
              href={`/l/${encodeURIComponent(slug)}/r/${r.id}`}
              title={r.eventName}
              subtitle={shortDate(r.startDate)}
              highlight={r.id === currentId}
            />
          ))}
          {tbaUrl ? (
            <a
              href={tbaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 w-full cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 text-[15px] font-semibold text-primary hover:bg-surface-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1">
                View on The Blue Alliance
                <span className="sr-only"> (opens in a new tab)</span>
              </span>
              <ExternalLink className="size-4 shrink-0" />
            </a>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}

/** Event switcher inside the Event tab's status strip (spec §6.5). */
export function EventSwitcher(props: Props) {
  const [open, setOpen] = useState(false);
  if (props.rounds.length <= 1 && !props.tbaUrl) {
    // Nothing to switch to: show the round name as a plain label, not a button.
    return (
      <span className="flex min-h-11 max-w-full items-center truncate rounded-full border border-border px-3 text-sm font-semibold text-fg">
        <span className="min-w-0 truncate">{props.currentName}</span>
      </span>
    );
  }
  return <EventSwitcherView {...props} open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} />;
}
