'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Moon, Sun } from '@/components/ui/icons';
import { THEME_STORAGE_KEY, type Theme } from '@/lib/theme';

/**
 * Sun/moon button in the header. The inline script in app/layout.tsx has already put the right
 * theme on <html> before paint; this only reads it after mount (so server and client markup match)
 * and flips it on tap, remembering the choice on this device.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  }, []);

  // Same footprint as the button, so the header doesn't shift when it appears.
  if (theme === null) return <span aria-hidden="true" className="size-11 shrink-0" />;

  const next: Theme = theme === 'dark' ? 'light' : 'dark';

  function toggle() {
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private browsing can block storage; the switch still works for this visit.
    }
    setTheme(next);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
    >
      {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </Button>
  );
}
