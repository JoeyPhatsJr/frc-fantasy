import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'live' | 'upcoming' | 'final' | 'drafting' | 'warning' | 'caution';

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
  upcoming: 'bg-surface-2 text-primary ring-1 ring-inset ring-border',
  final: 'bg-surface-2 text-fg-muted ring-1 ring-inset ring-border',
  drafting: 'bg-surface-2 text-fg ring-1 ring-inset ring-border',
  warning: 'bg-accent text-on-accent',
  // Needs attention but isn't a leader or a pick: neutral fill, warning text (gold fills are reserved, spec §4.2).
  caution: 'bg-surface-2 text-warning ring-1 ring-inset ring-border',
};

export function Badge({ tone, className, children }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[4px] px-2 py-0.5',
        'text-[11px] font-bold uppercase leading-4 tracking-[.08em]',
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
