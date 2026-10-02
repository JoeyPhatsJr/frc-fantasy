import Link from 'next/link';

export type TabItem = { key: string; label: string; href: string };

/** League tabs on the dark broadcast band (spec §5.3). Scrolls sideways instead of wrapping at 360px. */
export function BandTabs({ items, active, label }: { items: TabItem[]; active: string | null; label: string }) {
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-2 [scrollbar-width:none]">
      <ul className="flex min-w-max">
        {items.map((t) => {
          const on = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={on ? 'page' : undefined}
                className={[
                  'flex min-h-11 cursor-pointer items-center border-b-[3px] px-3 font-display text-[15px] font-semibold uppercase tracking-[.06em]',
                  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  on ? 'border-accent text-on-band' : 'border-transparent text-band-muted hover:text-on-band',
                ].join(' ')}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
