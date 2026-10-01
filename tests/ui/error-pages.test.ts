import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => '/' }));

import RootError from '@/app/error';
import LeagueError from '@/app/l/[slug]/error';

const props = { error: Object.assign(new Error('boom'), { digest: 'x' }), reset: () => {} };

describe('error boundaries (final review, Minor #3)', () => {
  it.each([
    ['app/error.tsx (/, /leagues, /me/settings, /join)', RootError],
    ['app/l/[slug]/error.tsx', LeagueError],
  ])('%s shows the friendly "database is asleep" page with a retry', (_name, Page) => {
    const out = renderToStaticMarkup(h(Page, props));
    expect(out).toContain('The league database is asleep');
    expect(out).toContain('Restore project');
    expect(out).toContain('Try again');
    expect(out).not.toContain('boom');
  });
});
