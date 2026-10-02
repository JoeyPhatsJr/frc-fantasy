import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BottomBarView } from '@/components/shell/BottomBar';
import { AppHeader } from '@/components/shell/AppHeader';
import { AppearanceControlView } from '@/components/you/AppearanceControl';

const r = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

// Next's <Link> may render aria-current before href, so match attribute order-agnostically.
const activeLink = (html: string, href: string) =>
  new RegExp(`<a(?=[^>]*href="${href}")(?=[^>]*aria-current="page")[^>]*>`).test(html);

describe('BottomBarView', () => {
  it('has Home, Leagues and You, fixed to the bottom with safe-area padding', () => {
    const html = r(h(BottomBarView, { pathname: '/' }));
    expect(html).toContain('aria-label="App"');
    for (const [label, href] of [['Home', '/'], ['Leagues', '/leagues'], ['You', '/you']]) {
      expect(html).toContain(`href="${href}"`);
      expect(html).toContain(label);
    }
    expect(html).toContain('fixed inset-x-0 bottom-0');
    expect(html).toContain('env(safe-area-inset-bottom)');
  });
  it('stays on league pages, with Leagues active', () => {
    const html = r(h(BottomBarView, { pathname: '/l/fam/r/1' }));
    expect(activeLink(html, '/leagues')).toBe(true);
    expect(activeLink(html, '/')).toBe(false);
  });
  it('marks You active on /you', () => {
    expect(activeLink(r(h(BottomBarView, { pathname: '/you' })), '/you')).toBe(true);
  });
});

describe('AppHeader', () => {
  it('is the dark band with the wordmark linking home', () => {
    const html = r(h(AppHeader, { signedIn: true }));
    expect(html).toContain('bg-band');
    expect(html).toContain('href="/"');
    expect(html).toContain('FRC FANTASY');
    expect(html).not.toContain('Sign in');
  });
  it('shows Sign in when signed out', () => {
    expect(r(h(AppHeader, { signedIn: false }))).toContain('href="/signin"');
  });
});

describe('AppearanceControlView', () => {
  it('is a two-option radio group with the current theme checked', () => {
    const html = r(h(AppearanceControlView, { theme: 'dark', onChange: () => {} }));
    expect(html).toContain('role="radiogroup"');
    const radios = html.match(/<button[^>]*role="radio"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(radios).toHaveLength(2);
    expect(radios.find((b) => b.includes('Dark'))).toContain('aria-checked="true"');
    expect(radios.find((b) => b.includes('Light'))).toContain('aria-checked="false"');
  });
  it('renders both unchecked before mount', () => {
    const html = r(h(AppearanceControlView, { theme: null, onChange: () => {} }));
    expect(html).not.toContain('aria-checked="true"');
  });
});
