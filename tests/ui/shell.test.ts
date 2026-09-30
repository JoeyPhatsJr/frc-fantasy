import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LeagueBar } from '@/components/LeagueBar';
import { ScoreboardSkeleton, Skeleton } from '@/components/Skeleton';
import { activeTab } from '@/lib/nav';
import { THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } from '@/lib/theme';

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('activeTab', () => {
  it('is standings on the league page, with or without a trailing slash', () => {
    expect(activeTab('/l/habich', 'habich')).toBe('standings');
    expect(activeTab('/l/habich/', 'habich')).toBe('standings');
  });

  it('is round on any public round page', () => {
    expect(activeTab('/l/habich/r/abc', 'habich')).toBe('round');
    expect(activeTab('/l/habich/r/abc/', 'habich')).toBe('round');
  });

  it('is admin on the dashboard and on admin round pages', () => {
    expect(activeTab('/l/habich/admin', 'habich')).toBe('admin');
    expect(activeTab('/l/habich/admin/r/abc', 'habich')).toBe('admin');
  });

  it('is null outside this league', () => {
    expect(activeTab('/', 'habich')).toBeNull();
    expect(activeTab('/l/other', 'habich')).toBeNull();
    expect(activeTab('/l/habich-2', 'habich')).toBeNull();
    expect(activeTab('/l/habich/administrator', 'habich')).toBeNull();
  });

  it('matches slugs literally', () => {
    expect(activeTab('/l/a.b', 'a.b')).toBe('standings');
    expect(activeTab('/l/axb', 'a.b')).toBeNull();
  });
});

describe('LeagueBar', () => {
  it('shows the league name linking to standings', () => {
    const html = render(h(LeagueBar, { slug: 'habich', name: 'Habich Fam', anyLive: false }));
    expect(html).toContain('Habich Fam');
    expect(html).toContain('href="/l/habich"');
  });

  it('shows a pulsing live dot with screen-reader text when a round is live', () => {
    const html = render(h(LeagueBar, { slug: 'habich', name: 'Habich Fam', anyLive: true }));
    expect(html).toContain('data-live-dot');
    expect(html).toContain('motion-safe:animate-pulse');
    expect(html).toContain('A round is live');
  });

  it('has no live dot when nothing is live', () => {
    const html = render(h(LeagueBar, { slug: 'habich', name: 'Habich Fam', anyLive: false }));
    expect(html).not.toContain('data-live-dot');
    expect(html).not.toContain('A round is live');
  });

  it('shows the Commissioner label only when told the viewer is one', () => {
    expect(render(h(LeagueBar, { slug: 'habich', name: 'Habich Fam', anyLive: false }))).not.toContain('Commissioner');
    expect(render(h(LeagueBar, { slug: 'habich', name: 'Habich Fam', anyLive: false, isCommissioner: true }))).toContain('Commissioner');
  });

  it('renders an optional back slot before the name', () => {
    const html = render(
      h(LeagueBar, { slug: 'habich', name: 'Habich Fam', anyLive: false, back: h('a', { href: '/x' }, 'Back') }),
    );
    expect(html.indexOf('Back')).toBeGreaterThan(-1);
    expect(html.indexOf('Back')).toBeLessThan(html.indexOf('Habich Fam'));
  });
});

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

  it('falls back to the device setting when nothing valid is saved', () => {
    expect(boot(null, true)).toBe('light');
    expect(boot(null, false)).toBe('dark');
    expect(boot('purple', true)).toBe('light');
  });

  it('still picks a theme when storage is blocked', () => {
    expect(boot(null, true, true)).toBe('light');
  });
});
