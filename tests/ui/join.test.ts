import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/' }));

import { JoinView, joinDescription } from '@/components/JoinView';

describe('joinDescription', () => {
  it('describes the league in plain words', () => {
    expect(joinDescription({ format: 'event' }, { eventName: 'Ramp Riot', startDate: '2026-10-24' })).toBe('Event by event · next up Ramp Riot, Oct 24');
    expect(joinDescription({ format: 'event' }, null)).toBe('Event by event · no events yet');
    expect(joinDescription({ format: 'season', seasonYear: 2026 }, null)).toBe('Full 2026 season');
    expect(joinDescription({ format: 'season', seasonYear: null }, null)).toBe('Full season');
  });
});

describe('JoinView', () => {
  const preview = { slug: 'fam', name: 'Family League', commissioner: 'Joey', memberCount: 4, full: false, alreadyMember: false };
  it('shows the invite card with description, commissioner and player count', () => {
    const out = render(h(JoinView, { preview, signedIn: true, code: 'ABC234', description: 'Full 2026 season' }));
    const text = out.replace(/<[^>]+>/g, '');
    expect(text).toContain("You&#x27;re invited toFamily League");
    expect(text).toContain('Full 2026 season');
    expect(text).toContain('Run by Joey · 4 players');
  });
  it('says 1 player for a single member', () => {
    const out = render(h(JoinView, { preview: { ...preview, memberCount: 1 }, signedIn: true, code: 'ABC234', description: 'x' }));
    expect(out).toContain('Run by Joey · 1 player');
    expect(out).not.toContain('1 players');
  });
});
