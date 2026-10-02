import type { ReactNode } from 'react';

export type StripTone = 'neutral' | 'live' | 'final' | 'drafting' | 'warning';

const TONE: Record<StripTone, string> = {
  neutral: 'border-l-border',
  live: 'border-l-success',
  final: 'border-l-fg-muted',
  drafting: 'border-l-accent',
  warning: 'border-l-warning',
};

/**
 * The one-line "where are we" header of a screen (spec §4.6, §6.5). A labelled region, not a live region:
 * it holds buttons, and only the detail line (e.g. "Last updated 2 min ago") is announced when it changes.
 */
export function StatusStrip({ tone, title, detail, action, switcher }: { tone: StripTone; title: ReactNode; detail?: ReactNode; action?: ReactNode; switcher?: ReactNode }) {
  return (
    <section aria-label="Status" className={`-mx-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-b-border border-l-4 bg-surface px-4 py-3 ${TONE[tone]}`}>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 break-words font-display text-[20px] font-bold leading-6 text-fg">
          {tone === 'live' ? (
            <span className="inline-flex items-center gap-1.5 rounded-[4px] bg-success px-1.5 py-0.5 font-body text-[11px] font-bold uppercase tracking-[.1em] text-on-success">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-on-success motion-safe:animate-pulse" />
              LIVE
            </span>
          ) : null}
          {title}
        </p>
        {detail ? (
          <p role="status" aria-live="polite" className="text-[13px] text-fg-muted">
            {detail}
          </p>
        ) : null}
      </div>
      {switcher}
      {action}
    </section>
  );
}
