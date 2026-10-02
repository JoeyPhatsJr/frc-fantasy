import type { ReactNode } from 'react';

/** An uppercase label over a run of rows (spec §4.3). Rows sit flush to the page edges. */
export function Section({ label, action, children, className, id }: { label: string; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  const headingId = id ? `${id}-h` : undefined;
  return (
    <section aria-labelledby={headingId} className={['-mx-4', className].filter(Boolean).join(' ')}>
      <div className="flex min-h-11 items-end justify-between gap-3 border-b border-border px-4 pb-2">
        <h2 id={headingId} className="text-[11px] font-bold uppercase tracking-[.12em] text-fg-muted">{label}</h2>
        {action ? <div className="text-sm">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
