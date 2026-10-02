'use client';

import { useRef } from 'react';

/** In-page tabs (state, not routes). Arrow keys move between tabs. */
export function PageTabs({
  items,
  active,
  onSelect,
  label,
}: {
  items: { key: string; label: string }[];
  active: string;
  onSelect: (key: string) => void;
  label: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKeyDown = (ev: React.KeyboardEvent, i: number) => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    ev.preventDefault();
    const next = items[(i + (ev.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
    if (!next) return;
    onSelect(next.key);
    refs.current[next.key]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="-mx-4 flex border-b border-border px-2">
      {items.map((t, i) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[t.key] = el;
            }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(t.key)}
            onKeyDown={(ev) => onKeyDown(ev, i)}
            className={[
              'min-h-11 cursor-pointer border-b-2 px-3 text-[15px] font-semibold',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              on ? 'border-fg text-fg' : 'border-transparent text-fg-muted',
            ].join(' ')}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
