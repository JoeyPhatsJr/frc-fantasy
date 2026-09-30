import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'live' | 'upcoming' | 'final' | 'drafting' | 'warning';

export type BadgeProps = {
  tone: BadgeTone;
  className?: string;
  children: ReactNode;
};

// Fills with their paired on-* text colour, so every tone is 4.5:1+ in both themes. Final is the
// quiet one: a finished round shouldn't compete with a live or upcoming one.
const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-fg-muted ring-1 ring-inset ring-border',
  live: 'bg-success text-on-success',
  upcoming: 'bg-primary-fill text-on-primary',
  final: 'bg-surface-2 text-fg-muted ring-1 ring-inset ring-border',
  drafting: 'bg-secondary text-on-secondary',
  warning: 'bg-accent text-on-accent',
};

export function Badge({ tone, className, children }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-0.5',
        'text-[13px] font-semibold leading-[18px]',
        TONES[tone],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {tone === 'live' && (
        <span aria-hidden="true" className="size-2 rounded-full bg-on-success motion-safe:animate-pulse" />
      )}
      {children}
    </span>
  );
}
