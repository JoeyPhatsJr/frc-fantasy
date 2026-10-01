import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/' }));

import { Landing } from '@/components/landing/Landing';

describe('Landing (spec §4.6)', () => {
  const upcoming = [{ key: '2026parr', name: 'Ramp Riot', start_date: '2026-10-24', end_date: '2026-10-24' }];
  it('has the hero, sign-in, invite box, sample scoreboard, how it works, formats, coming up', () => {
    const out = render(h(Landing, { upcoming, authError: false, next: '/' }));
    for (const text of [
      'Draft FRC teams. Watch every match. Roast your friends.',
      'type="password"', 'Create account', 'Have an invite code?',
      '+15 winner', 'Draft', 'Watch', 'Win', 'Event-by-event', 'Full season',
      'Coming up', 'Ramp Riot', 'href="/leagues/new?event=2026parr"',
    ]) expect(out, text).toContain(text);
  });
  it('omits Coming up when there are no events, and shows the auth error', () => {
    const out = render(h(Landing, { upcoming: [], authError: true, next: '/' }));
    expect(out).not.toContain('Coming up');
    expect(out).toContain('Sign-in didn&#x27;t finish — try again.');
  });
});
