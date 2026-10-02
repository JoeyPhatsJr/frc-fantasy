'use client';

import { useEffect, useState } from 'react';
import { THEME_STORAGE_KEY, type Theme } from '@/lib/theme';

const OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** The option an arrow key moves to from `from` (wrapping), or null for any other key. */
export function arrowTheme(key: string, from: Theme): Theme | null {
  const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[key];
  if (!step) return null;
  const i = OPTIONS.findIndex((o) => o.value === from);
  return OPTIONS[(i + step + OPTIONS.length) % OPTIONS.length].value;
}

/**
 * Segmented Light / Dark choice. `theme` is null until mounted, so server and client markup match.
 * A radio group is one Tab stop (the checked option; Light before mount) and arrow keys move the choice.
 */
export function AppearanceControlView({ theme, onChange }: { theme: Theme | null; onChange: (t: Theme) => void }) {
  const current = theme ?? 'light';
  const onKeyDown = (ev: React.KeyboardEvent<HTMLButtonElement>, from: Theme) => {
    const next = arrowTheme(ev.key, from);
    if (!next) return;
    ev.preventDefault();
    onChange(next);
    ev.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-value="${next}"]`)?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Appearance" className="inline-flex rounded-lg border border-border p-1">
      {OPTIONS.map(({ value, label }) => {
        const checked = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            data-value={value}
            aria-checked={checked}
            tabIndex={value === current ? 0 : -1}
            onClick={() => onChange(value)}
            onKeyDown={(ev) => onKeyDown(ev, value)}
            className={[
              'min-h-11 cursor-pointer rounded-md px-4 text-sm font-semibold motion-safe:transition-colors duration-150',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
              checked ? 'bg-fg text-bg' : 'text-fg-muted hover:text-fg',
            ].join(' ')}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The inline script in app/layout.tsx has already put the right theme on <html> before paint;
 * this reads it after mount and writes the choice back (and remembers it on this device).
 */
export function AppearanceControl() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  }, []);

  function choose(next: Theme) {
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private browsing can block storage; the switch still works for this visit.
    }
    setTheme(next);
  }

  return <AppearanceControlView theme={theme} onChange={choose} />;
}
