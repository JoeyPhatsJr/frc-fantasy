import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SignInForm } from '@/components/SignInForm';

describe('SignInForm', () => {
  it('sign-in mode: email, password, switch to create account, forgot-password hint', () => {
    const html = renderToStaticMarkup(createElement(SignInForm, { next: '/leagues' }));
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="current-password"');
    // Same words as the landing page's button ("Create an account").
    expect(html).toContain('New here? Create an account');
    expect(html).not.toMatch(/Create account/);
    expect(html).toContain('Forgot your password? Ask the league commissioner to reset it.');
    expect(html).not.toContain('site admin');
    expect(html).not.toContain('Continue with Google');
  });
  it('create-account mode asks for a name too', () => {
    const html = renderToStaticMarkup(createElement(SignInForm, { initialMode: 'signup' }));
    expect(html).toContain('Your name');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Create an account<\/button>/);
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('minLength="8"');
  });
  it('is a POST form so a pre-hydration submit never puts the password in the URL', () => {
    const html = renderToStaticMarkup(createElement(SignInForm, {}));
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).not.toMatch(/<form[^>]*method="get"/i);
  });
  it('server-rendered submit button is disabled until hydration (no native POST of the password)', () => {
    const html = renderToStaticMarkup(createElement(SignInForm, {}));
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });
  it('sign-up shows the password rule as a hint', () => {
    expect(renderToStaticMarkup(createElement(SignInForm, { initialMode: 'signup' }))).toContain('At least 8 characters.');
    expect(renderToStaticMarkup(createElement(SignInForm, {}))).not.toContain('At least 8 characters.');
  });
  it('mobile keyboard attributes on email and name', () => {
    const html = renderToStaticMarkup(createElement(SignInForm, { initialMode: 'signup' }));
    expect(html).toContain('autoCapitalize="none"');
    expect(html).toContain('autoCorrect="off"');
    expect(html).toContain('spellCheck="false"');
  });
  it('mode toggle has a focus ring and hover state', () => {
    const html = renderToStaticMarkup(createElement(SignInForm, {}));
    expect(html).toMatch(/<button[^>]*type="button"[^>]*focus-visible:ring-2/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*hover:text-fg/);
  });
});
