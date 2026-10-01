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
    expect(html).toContain('Create account');
    expect(html).toContain('Forgot your password? Ask the site admin to reset it.');
    expect(html).not.toContain('Continue with Google');
  });
  it('create-account mode asks for a name too', () => {
    const html = renderToStaticMarkup(createElement(SignInForm, { initialMode: 'signup' }));
    expect(html).toContain('Your name');
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('minLength="8"');
  });
  it('is a POST form so a pre-hydration submit never puts the password in the URL', () => {
    const html = renderToStaticMarkup(createElement(SignInForm, {}));
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).not.toMatch(/<form[^>]*method="get"/i);
  });
});
