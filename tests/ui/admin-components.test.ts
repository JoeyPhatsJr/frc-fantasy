import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminGateView } from '@/components/admin/AdminGate';
import { DangerZone } from '@/components/admin/DangerZone';
import { MembersCardView, memberActions, removeConfirmText } from '@/components/admin/MembersCard';
import { DashboardBody } from '@/components/admin/AdminDashboard';
import { AddRoundForm, RoundRows } from '@/components/admin/DashboardParts';
import { FollowTeamsForm } from '@/components/admin/FollowTeamsForm';
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
    expect(html).toContain('type="password"');
    expect(html).toContain('Sign in');
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

describe('AddRoundForm (now the EventPicker plus the Found preview)', () => {
  const html = render(
    h(AddRoundForm, {
      upcoming: [{ key: '2026parr', name: 'Ramp Riot', startDate: '2026-10-24', endDate: '2026-10-24' }],
      busy: false,
      checking: false,
      saving: false,
      onCheck: async () => null,
      onAdd: async () => true,
    }),
  );

  it('starts with the upcoming list, a labelled TBA link box and a Check button, and no Add button until a check', () => {
    expect(html).toContain('Ramp Riot');
    expect(html).toContain('TBA link or event code (like 2025parr)');
    expect(html).toContain('placeholder="2026parr"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>[^<]*Check<\/button>/);
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
const league = { slug: 'fam', name: 'Habich Fam', defaultScoring: DEFAULT_SCORING, inviteCode: 'ABC234', visibility: 'link' as const, format: 'event' as const, follows: [] };
const noop = () => {};

describe('MembersCard (spec §7.1: a row per member, actions behind ⋯)', () => {
  const props = { players: members, me: 'p1', busy: false, pending: null, onRole: noop, onRemove: noop, onOpen: noop, onClose: noop };
  const html = render(h(MembersCardView, { ...props, openId: null }));
  it('shows names, "(you)", former members as "(left)", and the Commissioner label', () => {
    expect(html).toContain('Members');
    expect(html).toContain('Joey (you)');
    expect(html).toContain('Grandpa (left)');
    expect(html.match(/>Commissioner</g)).toHaveLength(1);
  });
  it('has a ⋯ button for members with actions, none for a "(left)" row that still has history', () => {
    expect(html).toContain('aria-label="Options for Joey"');
    expect(html).toContain('aria-label="Options for Mom"');
    expect(html).not.toContain('aria-label="Options for Grandpa"');
    // The actions live in the sheet, so the closed list shows none of them.
    expect(html).not.toContain('Make commissioner');
    expect(html).not.toContain('aria-label="Remove Mom"');
  });
  it('the ⋯ sheet offers the role toggle and Remove', () => {
    const mom = render(h(MembersCardView, { ...props, openId: 'p2' }));
    expect(mom).toContain('role="dialog"');
    expect(mom).toContain('Make commissioner');
    expect(mom).toContain('aria-label="Remove Mom"');
    const joey = render(h(MembersCardView, { ...props, openId: 'p1' }));
    expect(joey).toContain('Make player');
    expect(joey).not.toContain('Make commissioner');
  });
  it('offers Remove for a "(left)" row with no history (so it stops counting toward the cap), but no role toggle', () => {
    const ghost = { id: 'p4', name: 'Ghost', inUse: false, role: 'player' as const, linked: false };
    expect(memberActions(ghost)).toEqual({ role: null, remove: true });
    const out = render(h(MembersCardView, { ...props, players: [members[0], ghost], openId: 'p4' }));
    expect(out).toContain('Ghost (left)');
    expect(out).toContain('aria-label="Remove Ghost"');
    expect(out).not.toMatch(/Make (commissioner|player)/);
  });
  it('memberActions: role toggles for linked members, nothing for "(left)" with history', () => {
    expect(memberActions(members[0])).toEqual({ role: 'player', remove: true });
    expect(memberActions(members[1])).toEqual({ role: 'commissioner', remove: true });
    expect(memberActions(members[2])).toEqual({ role: null, remove: false });
  });
});

const round = (over: Partial<Parameters<typeof RoundRows>[0]['rounds'][number]>) => ({
  id: 'r1', eventKey: '2026parr', kind: 'tba' as const, autoAdded: false, seasonYear: null, eventName: 'Ramp Riot',
  startDate: '2026-10-24', endDate: '2026-10-24', status: 'drafting' as const, pickCount: 4, totalPicks: 12, ...over,
});

describe('RoundRows (Events on the admin dashboard)', () => {
  const html = render(
    h(RoundRows, {
      slug: 'fam',
      follows: [5181],
      rounds: [round({}), round({ id: 'r2', eventName: 'Garage Games', kind: 'manual', eventKey: null, totalPicks: 0, pickCount: 0, autoAdded: true })],
    }),
  );
  it('links each row to its round admin, with picks progress and status', () => {
    expect(html).toMatch(/<a[^>]*href="\/l\/fam\/admin\/r\/r1"/);
    expect(html).toMatch(/<a[^>]*href="\/l\/fam\/admin\/r\/r2"/);
    expect(html).toContain('4 of 12 picks');
    expect(html).toContain('Draft not set up');
    expect(html).toContain('Auto-added · following 5181');
    expect(html).toContain('dateTime="2026-10-24"');
  });
  it('has no Delete on the rows (deleting moved into round admin)', () => {
    expect(html).not.toContain('Delete');
  });
});

const fixtureState = (format: 'event' | 'season', rounds = [round({})]) => ({
  league: { ...league, format },
  players: members,
  rounds,
  me: 'p1',
});
const body = (format: 'event' | 'season', rounds = [round({})]) =>
  render(
    h(DashboardBody, {
      slug: 'fam',
      state: fixtureState(format, rounds),
      upcoming: [{ key: '2026parr', name: 'Ramp Riot', startDate: '2026-10-24', endDate: '2026-10-24' }],
      busy: false,
      pending: null,
      run: async () => true,
      api: (async () => ({})) as never,
      lookUpEvent: async () => null,
      reload: async () => {},
      setNotice: noop,
    }),
  );

describe('DashboardBody (spec §7.1 order)', () => {
  const html = body('event');
  const at = (text: string) => {
    const i = html.indexOf(text);
    expect(i, text).toBeGreaterThanOrEqual(0);
    return i;
  };
  it('goes Invite people → Events → Members → Settings → Danger zone', () => {
    const order = ['Invite people', '>Events<', '>Members<', '>Settings<', 'Danger zone'].map(at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('shows the invite code in the Invite card, and visibility under Settings', () => {
    expect(at('ABC234')).toBeLessThan(at('>Events<'));
    expect(at('Who can see the league?')).toBeGreaterThan(at('>Settings<'));
    expect(at('Who can see the league?')).toBeLessThan(at('Danger zone'));
    expect(html).toContain('Anyone with the link');
    expect(html).toContain('Members only');
  });
  it('has the league name and a collapsed Default scoring under Settings', () => {
    expect(at('>League name</label>')).toBeGreaterThan(at('>Settings<'));
    expect(html).toMatch(/<details[^>]*>\s*<summary[^>]*>Default scoring/);
  });
  it('tucks manual events and follow teams in "More ways to add events"', () => {
    expect(html).toMatch(/<details[^>]*>\s*<summary[^>]*>More ways to add events/);
    expect(at('Add manual event')).toBeGreaterThan(at('More ways to add events'));
    expect(at('Follow teams (up to 3)')).toBeGreaterThan(at('More ways to add events'));
  });
  it('drops the old View/Copy league link header row and Delete on event rows', () => {
    expect(html).not.toContain('View public page');
    expect(html).not.toContain('Copy public link');
    expect(html).not.toMatch(/Delete Ramp Riot/);
  });
  it('season leagues get a Season section, no event picker, and the start-next-season button once final', () => {
    const season = round({ kind: 'season', eventKey: null, seasonYear: 2026, eventName: '2026 season', status: 'final' });
    const out = body('season', [season]);
    expect(out).toContain('>Season<');
    expect(out).not.toContain('>Events<');
    expect(out).not.toContain('TBA link or event code');
    expect(out).not.toContain('More ways to add events');
    expect(out).toContain('Start 2027 season');
    expect(out).toMatch(/<a[^>]*href="\/l\/fam\/admin\/r\/r1"/);
    const ongoing = body('season', [{ ...season, status: 'live' }]);
    expect(ongoing).toContain('Mark this season final to start the next one.');
  });
});

describe('FollowTeamsForm helper text (spec §6.10)', () => {
  it('explains following in plain words', () => {
    const out = render(h(FollowTeamsForm, { follows: [], busy: false, saving: false, onSave: async () => true }));
    expect(out).toContain('Follow up to 3 teams and we&#x27;ll add each event they attend automatically.');
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
