import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/' }));

import { Landing, MatchLineup } from '@/components/landing/Landing';
import { SampleScoreboard } from '@/components/landing/SampleScoreboard';

describe('Landing (spec §4.6, landing redesign 2026-09-30)', () => {
  const upcoming = [{ key: '2026parr', name: 'Ramp Riot', start_date: '2026-10-24', end_date: '2026-10-24' }];
  const out = render(h(Landing, { upcoming, authError: false, next: '/' }));
  // Visible text, for sentences that span inline elements (e.g. the gold point values).
  const text = out.replace(/<[^>]+>/g, '');

  it('has the three-line hero, create-account button, invite code, sample league, how it works, coming up', () => {
    for (const text of [
      'Draft FRC teams.', 'Watch every match.', 'Roast your friends.',
      'href="/signin?mode=signup"', 'Create an account', 'Have an invite code?',
      'A league in the middle of a season',
      'How it works', 'Draft', 'Watch', 'Win',
      'Coming up', 'Ramp Riot', 'href="/leagues/new?event=2026parr"', 'Start a league',
    ]) expect(out, text).toContain(text);
    expect(text).toContain('341 earned +10 for rank, +8 as a captain and +15 for winning the event.');
  });

  it('has no sign-in form on the landing page', () => {
    expect(out).not.toContain('type="password"');
  });

  it('drops Joey, the formats section and the duplicate footer', () => {
    expect(out).not.toContain('Joey');
    expect(out).not.toContain('Two ways to play');
    expect(out).not.toContain('Full season');
    expect(out).not.toContain('<footer');
  });

  it('sets the headline in sentence case (no uppercase class)', () => {
    const h1 = out.match(/<h1[^>]*>/)?.[0] ?? '';
    expect(h1).not.toBe('');
    expect(h1).not.toContain('uppercase');
  });

  it('balances the headline and leaves no trailing spaces inside its lines', () => {
    const h1 = out.match(/<h1[^>]*>/)?.[0] ?? '';
    expect(h1).toContain('text-balance');
    expect(out).not.toMatch(/\. <\/span>/);
  });

  it('shows the match lineup: three blue plates, vs, three red plates, hidden from screen readers', () => {
    expect(out).toContain('data-match-lineup');
    const lineup = render(h(MatchLineup));
    expect(lineup).toMatch(/^<div[^>]*aria-hidden="true"/);
    expect(lineup.split('role="img"').length - 1).toBe(6);
    expect(lineup.split('bg-primary-fill').length - 1).toBe(3);
    expect(lineup.split('bg-red-alliance').length - 1).toBe(3);
    expect(lineup).toContain('vs');
  });

  it('keeps next on the create-account link when there is somewhere to come back to', () => {
    const withNext = render(h(Landing, { upcoming: [], authError: false, next: '/join/ABC234' }));
    expect(withNext).toContain('href="/signin?mode=signup&amp;next=%2Fjoin%2FABC234"');
  });

  it('omits Coming up when there are no events, and shows the auth error', () => {
    const empty = render(h(Landing, { upcoming: [], authError: true, next: '/' }));
    expect(empty).not.toContain('Coming up');
    expect(empty).toContain('Sign-in didn&#x27;t finish — try again.');
  });
});

describe('SampleScoreboard', () => {
  const out = render(h(SampleScoreboard));
  it('is a family league without Joey, explained in a sentence with no middle dots', () => {
    for (const name of ['Mom', 'Sis', 'Dad', 'Grandpa']) expect(out).toContain(name);
    expect(out).not.toContain('Joey');
    expect(out).not.toContain('·');
    expect(out).toContain('earned');
    expect(out).toContain('+10');
    expect(out).toContain('for rank');
  });
  it('does not animate on load', () => {
    expect(out).not.toContain('animate-fade-up');
  });
});
