import { renderToStaticMarkup as render } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/signin',
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('@/lib/auth/session', () => ({ getUser: () => m.getUser() }));

import SignInPage, { dynamic } from '@/app/signin/page';

const page = (sp: Record<string, string>) => SignInPage({ searchParams: Promise.resolve(sp) });

describe('/signin page', () => {
  beforeEach(() => m.getUser.mockResolvedValue(null));

  it("is force-dynamic (spec §9.2)", () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('signed out: sign-in mode by default, with a password field', async () => {
    const html = render(await page({}));
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).not.toContain('Your name');
  });

  it('?mode=signup opens in create-account mode', async () => {
    const html = render(await page({ mode: 'signup' }));
    expect(html).toContain('Your name');
    expect(html).toContain('autoComplete="new-password"');
  });

  it('the page title follows the mode', async () => {
    expect(render(await page({}))).toMatch(/<h1[^>]*>Sign in<\/h1>/);
    expect(render(await page({ mode: 'signup' }))).toMatch(/<h1[^>]*>Create an account<\/h1>/);
  });

  it('an unknown mode falls back to sign-in', async () => {
    expect(render(await page({ mode: 'nope' }))).not.toContain('Your name');
  });

  it('signed in: redirects to the sanitized next', async () => {
    m.getUser.mockResolvedValue({ id: 'u1' });
    await expect(page({ next: '/join/ABC234' })).rejects.toThrow('REDIRECT:/join/ABC234');
    await expect(page({ next: '//evil.com' })).rejects.toThrow(/^REDIRECT:\/$/);
    await expect(page({})).rejects.toThrow(/^REDIRECT:\/$/);
  });
});
