import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => '/',
}));

import { DraftRoomBanner } from '@/components/draft/DraftRoomBanner';
import { Landing } from '@/components/landing/Landing';
import { LeagueHeaderView } from '@/components/shell/LeagueHeader';
import type { DraftState } from '@/lib/draft/state';

const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');

/** The first element in `html` carrying bg-band (the band itself, not the header above it). */
function bandClass(html: string): string {
  const m = /class="([^"]*\bbg-band\b[^"]*)"/.exec(html);
  expect(m, 'no bg-band element').not.toBeNull();
  return m![1];
}

// Dark bands under the full-width header must reach the window edges on wide screens too,
// not stop at the 42rem content column (Joey 2026-10-02: "a floating black box").
describe('full-bleed dark bands', () => {
  it('defines one shared full-bleed utility', () => {
    expect(css).toMatch(/@utility full-bleed-band\s*\{[^}]*border-image:[^}]*100vmax/);
  });

  it('the landing hero bleeds to the window edges', () => {
    const html = renderToStaticMarkup(h(Landing, { upcoming: [], authError: false, next: '/' }));
    expect(bandClass(html)).toContain('full-bleed-band');
  });

  it('the league header band bleeds to the window edges', () => {
    const html = renderToStaticMarkup(
      h(LeagueHeaderView, {
        slug: 'fam', name: 'Family', format: 'event', isCommissioner: false, isMember: true,
        myName: 'Joey', targetRoundId: 'r1', anyLive: false, myLeagues: [], pathname: '/l/fam',
      }),
    );
    expect(bandClass(html)).toContain('full-bleed-band');
  });

  it('the draft room banner bleeds to the window edges', () => {
    const state: DraftState = {
      phase: 'setup', draftMode: 'live', pickNumber: 0, totalPicks: 4, onClock: null, deadline: null,
      serverNow: '2026-10-23T23:00:00.000Z', pickSeconds: 60, pausedRemainingMs: null,
      order: [{ playerId: 'joey', name: 'Joey' }, { playerId: 'mom', name: 'Mom' }],
      rosterSize: 2, picks: [], autodraftPlayerIds: [],
    } as DraftState;
    const html = renderToStaticMarkup(
      h(DraftRoomBanner, { state, remainingMs: null, meId: null, reconnecting: false, myPosition: null, playerCount: 2 }),
    );
    expect(bandClass(html)).toContain('full-bleed-band');
  });
});
