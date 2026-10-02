import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronDown } from '@/components/ui/icons';

export type RowProps = {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  highlight?: boolean;
  expanded?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

const BASE = 'flex min-h-11 w-full items-center gap-3 border-b border-border px-4 py-2.5 text-left';
const HIGHLIGHT = 'bg-surface shadow-[inset_4px_0_0_var(--color-primary-fill)]';
const FOCUS = 'cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

function Body({ leading, title, subtitle, trailing, chevron }: Pick<RowProps, 'leading' | 'title' | 'subtitle' | 'trailing'> & { chevron?: boolean }) {
  return (
    <>
      {leading ? <span className="flex shrink-0 items-center">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-fg">{title}</span>
        {subtitle ? <span className="block truncate text-[13px] text-fg-muted">{subtitle}</span> : null}
      </span>
      {trailing ? <span className="flex shrink-0 items-center gap-2">{trailing}</span> : null}
      {chevron ? <ChevronDown className="size-4 shrink-0 text-fg-muted motion-safe:transition-transform group-open:rotate-180" /> : null}
    </>
  );
}

/** A list row on the page background: hairline divider, optional link or expansion (spec §4.3, §4.6). */
export function Row({ leading, title, subtitle, trailing, href, highlight, expanded, defaultOpen, className }: RowProps) {
  const tone = highlight ? HIGHLIGHT : '';
  if (expanded !== undefined) {
    return (
      <details className={['group', tone, className].filter(Boolean).join(' ')} open={defaultOpen || undefined}>
        <summary className={`${BASE} ${FOCUS} list-none [&::-webkit-details-marker]:hidden`}>
          <Body leading={leading} title={title} subtitle={subtitle} trailing={trailing} chevron />
        </summary>
        <div className="border-b border-border bg-surface px-4 py-2 pl-12">{expanded}</div>
      </details>
    );
  }
  if (href) {
    return (
      <Link href={href} className={[BASE, FOCUS, tone, 'hover:bg-surface-2', className].filter(Boolean).join(' ')}>
        <Body leading={leading} title={title} subtitle={subtitle} trailing={trailing} />
      </Link>
    );
  }
  return (
    <div className={[BASE, tone, className].filter(Boolean).join(' ')}>
      <Body leading={leading} title={title} subtitle={subtitle} trailing={trailing} />
    </div>
  );
}

const PODIUM: Record<number, string> = { 1: 'text-accent-text', 2: 'text-silver', 3: 'text-bronze' };

export function RankNumeral({ rank }: { rank: number }) {
  return (
    <span className={`w-6 text-center font-display text-[22px] font-bold leading-none tabular-nums ${PODIUM[rank] ?? 'text-fg-muted'}`}>
      {rank}
    </span>
  );
}

export function Points({ value, size = 'lg' }: { value: number | null; size?: 'lg' | 'md' }) {
  const cls = size === 'lg' ? 'text-[26px]' : 'text-[19px]';
  return <span className={`font-display ${cls} font-bold leading-none tabular-nums text-fg`}>{value === null ? '—' : value}</span>;
}
