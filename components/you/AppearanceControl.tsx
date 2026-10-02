'use client';

import { useEffect, useState } from 'react';
import { THEME_STORAGE_KEY, type Theme } from '@/lib/theme';

const OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Segmented Light / Dark choice. `theme` is null until mounted, so server and client markup match. */
export function AppearanceControlView({ theme, onChange }: { theme: Theme | null; onChange: (t: Theme) => void }) {
  return (
    <div role="radiogroup" aria-label="Appearance" className="inline-flex rounded-lg border border-border p-1">
      {OPTIONS.map(({ value, label }) => {
        const checked = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(value)}
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
