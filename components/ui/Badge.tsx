import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'live' | 'upcoming' | 'final' | 'drafting' | 'warning';

export type BadgeProps = {
  tone: BadgeTone;
  className?: string;
  children: ReactNode;
};

// Solid fills where a tinted fill would drop text contrast below 4.5:1.
const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-fg-muted ring-1 ring-inset ring-border',
  live: 'bg-success text-on-primary',
  upcoming: 'bg-primary/10 text-primary-strong',
  final: 'bg-fg text-on-primary',
  drafting: 'bg-secondary text-on-primary',
  warning: 'bg-accent text-fg',
};

export function Badge({ tone, className, children }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-0.5',
        'text-xs font-bold uppercase tracking-wide',
        TONES[tone],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {tone === 'live' && (
        <span aria-hidden="true" className="size-2 rounded-full bg-on-primary motion-safe:animate-pulse" />
      )}
      {children}
    </span>
  );
}
