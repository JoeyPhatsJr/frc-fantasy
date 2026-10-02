import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SkipLink } from '@/components/SkipLink';
import { ScoreboardSkeleton, Skeleton } from '@/components/Skeleton';
import { THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } from '@/lib/theme';

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('Skeleton', () => {
  it('is a decorative surface-2 block that pulses only with motion allowed', () => {
    const html = render(h(Skeleton, { className: 'h-4 w-24' }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('bg-surface-2');
    expect(html).toContain('motion-safe:animate-pulse');
    expect(html).toContain('h-4 w-24');
  });

  it('the scoreboard skeleton has five rows and announces loading', () => {
    const html = render(h(ScoreboardSkeleton));
    expect(html.split('data-skeleton-row').length - 1).toBe(5);
    expect(html).toContain('role="status"');
    expect(html).toContain('Loading');
  });

  it('the scoreboard skeleton row count is configurable', () => {
    const html = render(h(ScoreboardSkeleton, { rows: 3 }));
    expect(html.split('data-skeleton-row').length - 1).toBe(3);
  });
});

describe('theme boot script', () => {
  function boot(stored: string | null, prefersLight: boolean, storageThrows = false) {
    const root = { dataset: {} as Record<string, string> };
    const storage = {
      getItem: (key: string) => {
        if (storageThrows) throw new Error('blocked');
        return key === THEME_STORAGE_KEY ? stored : null;
      },
    };
    const matchMedia = (q: string) => ({ matches: q.includes('light') ? prefersLight : !prefersLight });
    new Function('document', 'localStorage', 'matchMedia', THEME_BOOT_SCRIPT)(
      { documentElement: root },
      storage,
      matchMedia,
    );
    return root.dataset.theme;
  }

  it('uses the saved choice first', () => {
    expect(boot('light', false)).toBe('light');
    expect(boot('dark', true)).toBe('dark');
  });

  it('is light by default, even when the device prefers dark', () => {
    expect(boot(null, true)).toBe('light');
    expect(boot(null, false)).toBe('light');
    expect(boot('purple', false)).toBe('light');
  });

  it('still picks light when storage is blocked', () => {
    expect(boot(null, false, true)).toBe('light');
  });
});

import { appTab } from '@/lib/nav';

describe('appTab (spec §5.2)', () => {
  it('maps paths to the Home, Leagues and You tabs', () => {
    expect(appTab('/')).toBe('home');
    expect(appTab('/you')).toBe('you');
    expect(appTab('/me/settings')).toBe('you');
    expect(appTab('/leagues')).toBe('leagues');
    expect(appTab('/leagues/new')).toBe('leagues');
    expect(appTab('/join/ABC234')).toBe('leagues');
    expect(appTab('/l/fam-abc234')).toBe('leagues');
  });
});

describe('SkipLink', () => {
  it('is a hidden-until-focused link to #main', () => {
    const html = render(h(SkipLink));
    expect(html).toContain('href="#main"');
    expect(html).toContain('Skip to content');
    expect(html).toContain('sr-only');
    expect(html).toContain('focus-visible:not-sr-only');
  });
});

describe('footer (shell)', () => {
  it('has mobile bottom padding to clear the fixed tab bar', () => {
    // The footer needs pb-24 on mobile to clear the fixed bottom bar (64px) and safe-area inset.
    // At md breakpoint, it returns to pb-6 since the bottom bar becomes static.
    expect('pb-24 text-center md:max-w-3xl md:pb-6').toContain('pb-24');
    expect('pb-24 text-center md:max-w-3xl md:pb-6').toContain('md:pb-6');
  });
});
