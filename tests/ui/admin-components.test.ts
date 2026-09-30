import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminGateView } from '@/components/admin/AdminGate';
import { DangerZone } from '@/components/admin/DangerZone';
import { MembersCard, removeConfirmText } from '@/components/admin/MembersCard';
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

const members = [
  { id: 'p1', name: 'Joey', inUse: true, role: 'commissioner' as const, linked: true },
  { id: 'p2', name: 'Mom', inUse: true, role: 'player' as const, linked: true },
  { id: 'p3', name: 'Grandpa', inUse: true, role: 'player' as const, linked: false },
];
const league = { slug: 'fam', name: 'Habich Fam', homeTeamNumber: 5181, defaultScoring: DEFAULT_SCORING, inviteCode: 'ABC234', visibility: 'link' as const };
const noop = () => {};

describe('MembersCard (spec §4.6 admin additions)', () => {
  const html = render(
    h(MembersCard, {
      inviteLink: 'https://x.test/join/ABC234', league, players: members, me: 'p1', busy: false, pending: null,
      onReset: noop, onVisibility: noop, onRole: noop, onRemove: noop,
    }),
  );
  it('shows the invite code, copy link and reset', () => {
    expect(html).toContain('ABC234');
    expect(html).toContain('Copy invite link');
    expect(html).toContain('Reset code');
  });
  it('shows roles, "(you)", and former members as "(left)" without a role toggle', () => {
    expect(html).toContain('Joey (you)');
    expect(html).toContain('Grandpa (left)');
    expect(html).toContain('Make commissioner'); // for Mom
    expect(html).toContain('Make player'); // for Joey
    expect(html.match(/Make commissioner/g)).toHaveLength(1); // not for Grandpa
  });
  it('shows the visibility choice', () => {
    expect(html).toContain('Anyone with the link');
    expect(html).toContain('Members only');
  });
});

describe('removeConfirmText', () => {
  it('explains that someone with history stays in past standings', () => {
    expect(removeConfirmText(members[1])).toBe(
      'Remove Mom? They have picks or are in a draft order, so they stay in past standings as "Mom (left)".',
    );
    expect(removeConfirmText({ ...members[1], inUse: false })).toBe('Remove Mom from the league?');
  });
});

describe('DangerZone', () => {
  it('asks for the league name and starts disabled', () => {
    const out = render(h(DangerZone, { leagueName: 'Habich Fam', busy: false, onDelete: noop }));
    expect(out).toContain('Type Habich Fam to confirm');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Delete league/);
  });
});
