import type { ReactNode } from 'react';

export type CardProps = {
  /** Section heading, rendered as an <h2> in the display font. */
  title?: ReactNode;
  /** Small muted label above the title. */
  eyebrow?: ReactNode;
  /** Right-aligned node in the header row (a button, link, badge...). */
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
};

export function Card({ title, eyebrow, action, className, children }: CardProps) {
  const hasHeader = title != null || eyebrow != null || action != null;
  return (
    <div
      className={['rounded-card border border-border bg-surface p-4', className]
        .filter(Boolean)
        .join(' ')}
    >
      {hasHeader && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow != null && (
              <p className="text-[11px] font-bold uppercase leading-4 tracking-[.12em] text-fg-muted">{eyebrow}</p>
            )}
            {title != null && (
              <h2 className="font-display text-[22px] font-bold leading-[26px] break-words text-fg">
                {title}
              </h2>
            )}
          </div>
          {action != null && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
