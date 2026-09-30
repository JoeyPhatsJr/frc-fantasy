import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminGateView } from '@/components/admin/AdminGate';
import { AddRoundForm } from '@/components/admin/DashboardParts';
import { bannerParts, pickFontSize } from '@/components/admin/DraftEntry';
import { ScoringForm } from '@/components/admin/ScoringForm';
import { draftBanner } from '@/lib/draft';
import { DEFAULT_SCORING } from '@/lib/scoring/config';

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('AdminGateView', () => {
  const kids = () => h('p', null, 'secret dashboard');
  it('shows the checking state first', () => {
    const html = render(h(AdminGateView, { slug: 'abc', next: '/l/abc/admin', session: { status: 'checking' }, children: kids }));
    expect(html).toContain('Checking your account…');
    expect(html).not.toContain('secret dashboard');
  });
  it('asks a signed-out visitor to sign in and come back here', () => {
    const html = render(h(AdminGateView, { slug: 'abc', next: '/l/abc/admin/r/1', session: { status: 'signed_out' }, children: kids }));
    expect(html).toContain('Sign in to manage this league');
    expect(html).toContain('Continue with Google');
    expect(html).toContain('Continue with Discord');
    expect(html).not.toContain('secret dashboard');
  });
  it('tells a signed-in non-commissioner plainly', () => {
    const html = render(h(AdminGateView, { slug: 'abc', next: '/l/abc/admin', session: { status: 'forbidden' }, children: kids }));
    expect(html).toContain("You&#x27;re not a commissioner of this league");
    expect(html).toContain('href="/l/abc"');
  });
});

describe('ScoringForm', () => {
  const html = render(
    h(ScoringForm, { initial: DEFAULT_SCORING, saveLabel: 'Save default scoring', onSave: async () => {} }),
  );

  it('shows every group and both action buttons', () => {
    for (const title of [
      'Qualification matches',
      'Qualification rank',
      'Alliance selection',
      'Playoffs',
      'Awards',
      'OPR bonus (after quals)',
    ]) {
      expect(html).toContain(`>${title}</legend>`);
    }
    expect(html).toContain('Save default scoring');
    expect(html).toContain('Reset to defaults');
  });

  it('renders every field as a labelled number box', () => {
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    // 4 qual + 3 tiers × 2 + 5 alliance + 3 playoffs + 4 awards + 3 OPR places
    expect(inputs).toHaveLength(25);
    for (const input of inputs) {
      expect(input).toContain('type="number"');
      const id = input.match(/ id="([^"]+)"/)?.[1];
      const labelled = input.includes('aria-label="') || (id !== undefined && html.includes(`for="${id}"`));
      expect(labelled, input).toBe(true);
    }
  });

  it('starts from the given values', () => {
    expect(html).toContain('value="3"'); // qualWin
    expect(html).toContain('value="15"'); // eventWinner
  });
});

describe('AddRoundForm', () => {
  const html = render(
    h(AddRoundForm, {
      busy: false,
      checking: false,
      saving: false,
      onCheck: async () => null,
      onAdd: async () => true,
    }),
  );

  it('starts with a labelled key box and a Check button, and no Add button until a check', () => {
    expect(html).toContain('Add a round by event key');
    expect(html).toContain('placeholder="2026parr"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Check<\/button>/);
    expect(html).not.toContain('Add this round');
  });
});

describe('bannerParts (draft-night banner)', () => {
  const order = ['a', 'b', 'c'];
  const names = { a: 'Mom', b: 'Dad', c: 'Joey' };

  it('agrees with draftBanner() at every point of the draft', () => {
    for (let pickCount = 0; pickCount <= 6; pickCount++) {
      const parts = bannerParts(pickCount, order, 2, names);
      const text = draftBanner({ pickCount, draftOrder: order, rosterSize: 2, playerNames: names });
      if (parts.kind === 'pick') {
        expect(text).toBe(`Pick ${parts.pick} of ${parts.total} — ${parts.picker}'s turn (round ${parts.draftRound})`);
      } else {
        expect(parts).toEqual({ kind: 'complete', total: 6 });
        expect(text).toBe('Draft complete — 6 of 6 picks');
      }
    }
  });

  it('follows the snake: pick 4 is the last player again, in round 2', () => {
    expect(bannerParts(3, order, 2, names)).toEqual({ kind: 'pick', pick: 4, total: 6, picker: 'Joey', draftRound: 2 });
  });

  it('asks for a draft order when there is none', () => {
    expect(bannerParts(0, [], 2, names)).toEqual({ kind: 'no-order' });
  });
});

describe('pickFontSize (draft banner stays on one line)', () => {
  it('shrinks more as the "Pick N of M" label gets longer, capped at 56px', () => {
    expect(pickFontSize(9, 20)).toBe('min(56px, 21.7cqw)');
    expect(pickFontSize(10, 20)).toBe('min(56px, 19.6cqw)');
    expect(pickFontSize(100, 120)).toBe('min(56px, 16.4cqw)');
  });
});
