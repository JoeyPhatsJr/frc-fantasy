import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/' }));

import AdminPage from '@/app/l/[slug]/admin/page';
import { AdminDashboard, FIRST_ROUND_FAILED, leagueLinkLabels } from '@/components/admin/AdminDashboard';
import { addFirstRound, afterCreateUrl, CreateLeagueForm, formatFields } from '@/components/CreateLeagueForm';
import { InviteCodeBox } from '@/components/InviteCodeBox';
import { JoinView } from '@/components/JoinView';
import { SettingsForm } from '@/components/SettingsForm';

const preview = {
  slug: 'habich-fam-abc234', name: 'Habich Fam', commissioner: 'Joey', memberCount: 3, full: false, alreadyMember: false,
};

describe('JoinView (spec §4.6 /join)', () => {
  it('signed out: league name and sign-in form that comes back here', () => {
    const out = render(h(JoinView, { preview, signedIn: false, code: 'ABC234' }));
    expect(out).toContain('Habich Fam');
    expect(out).toContain('type="password"');
    expect(out).toContain('Sign in');
    expect(out).not.toContain('Commissioner: Joey'); // details only after sign-in
  });
  it('signed in: commissioner, member count and a Join button', () => {
    const out = render(h(JoinView, { preview, signedIn: true, code: 'ABC234' }));
    expect(out).toContain('Commissioner: Joey');
    expect(out).toContain('3 members');
    expect(out).toContain('>Join<');
  });
  it('full league and bad code messages', () => {
    expect(render(h(JoinView, { preview: { ...preview, full: true }, signedIn: true, code: 'ABC234' }))).toContain('League is full');
    expect(render(h(JoinView, { preview: null, signedIn: true, code: 'NOPE' }))).toContain(
      'That invite code doesn&#x27;t work — check with your commissioner.',
    );
  });
});

describe('CreateLeagueForm', () => {
  it('has name, the two visibility choices, and no passcode', () => {
    const out = render(h(CreateLeagueForm, {}));
    expect(out).toContain('League name');
    expect(out).toContain('Anyone with the link can view');
    expect(out).toContain('Members only');
    expect(out).not.toMatch(/passcode/i);
  });
  it('shows the prefilled first round', () => {
    const out = render(h(CreateLeagueForm, { event: { key: '2026parr', name: 'Ramp Riot 2026' } }));
    expect(out).toContain('First round: Ramp Riot 2026');
  });
  it('offers event-by-event (picked) or full season, says it is permanent, and asks for follows', () => {
    const out = render(h(CreateLeagueForm, {}));
    expect(out).toContain('How do you want to play?');
    expect(out).toContain('Event by event');
    expect(out).toContain('Full season');
    expect(out).toContain('You can&#x27;t change this after the league is created.');
    expect(out).toMatch(/name="format" checked="" value="event"/);
    expect(out).toContain('Follow teams (optional, up to 3)');
  });
});

describe('formatFields (the format part of the create-league body)', () => {
  it('event: parses follows, or reports the follow error', () => {
    expect(formatFields({ format: 'event', follows: '5181, frc341', seasonYear: 2027, poolFilter: { type: 'all' } })).toEqual({
      ok: true,
      fields: { format: 'event', followTeams: [5181, 341] },
    });
    expect(formatFields({ format: 'event', follows: '1 2 3 4', seasonYear: 2027, poolFilter: { type: 'all' } })).toEqual({
      ok: false,
      on: 'follows',
      error: 'Follow at most 3 teams',
    });
  });
  it('season: sends the year and pool filter, and wants a district picked', () => {
    expect(formatFields({ format: 'season', follows: 'junk', seasonYear: 2027, poolFilter: { type: 'district', key: '2027fma' } })).toEqual({
      ok: true,
      fields: { format: 'season', seasonYear: 2027, poolFilter: { type: 'district', key: '2027fma' } },
    });
    expect(formatFields({ format: 'season', follows: '', seasonYear: 2027, poolFilter: { type: 'district', key: '' } })).toEqual({
      ok: false,
      on: 'pool',
      error: 'Pick a district',
    });
  });
});

describe('a failed prefilled first round is not silent (final review, Minor #13)', () => {
  it('sends the commissioner to the dashboard with round_error=1 only when adding the round failed', () => {
    expect(afterCreateUrl('fam-abc234', false)).toBe('/l/fam-abc234/admin');
    expect(afterCreateUrl('fam-abc234', true)).toBe('/l/fam-abc234/admin?round_error=1');
  });
  it('the admin page passes the flag to the dashboard, which explains what happened', async () => {
    const page = (slug: string, sp: Record<string, string>) =>
      AdminPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(sp) });
    const failed = await page('fam-abc234', { round_error: '1' });
    expect(failed.type).toBe(AdminDashboard);
    expect(failed.props).toEqual({ slug: 'fam-abc234', firstRoundFailed: true });
    expect((await page('fam-abc234', {})).props).toEqual({ slug: 'fam-abc234', firstRoundFailed: false });
    expect(FIRST_ROUND_FAILED).toBe("Your league is ready, but the first round couldn't be added. Add it under Rounds below.");
  });
});

describe('addFirstRound: the prefilled event from /leagues/new?event= (SP2 final review, Minor 1)', () => {
  const answer = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

  it('posts the event to the new league', async () => {
    const fetchImpl = answer(201, { round: { id: 'r1' } });
    expect(await addFirstRound('fam-abc234', '2026parr', fetchImpl as never)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/l/fam-abc234/admin/rounds',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ eventKey: '2026parr' }) }),
    );
  });

  it("counts 409 'already in this league' as added: the follow sync got there first", async () => {
    const fetchImpl = answer(409, { error: 'That event is already in this league' });
    expect(await addFirstRound('fam-abc234', '2026parr', fetchImpl as never)).toBe(true);
  });

  it('reports any other failure, so the dashboard can say the round is missing', async () => {
    expect(await addFirstRound('fam-abc234', '2026parr', answer(503, { error: 'TBA down' }) as never)).toBe(false);
    expect(await addFirstRound('fam-abc234', '2026parr', answer(404, { error: 'No such event' }) as never)).toBe(false);
    const offline = vi.fn(async () => {
      throw new TypeError('offline');
    });
    expect(await addFirstRound('fam-abc234', '2026parr', offline as never)).toBe(false);
  });
});

describe('admin shortcuts (final review, Minor #6)', () => {
  it('only call the league page "public" when it is', () => {
    expect(leagueLinkLabels('link')).toEqual({ view: 'View public page', copy: 'Copy public link' });
    expect(leagueLinkLabels('members')).toEqual({ view: 'View league page', copy: 'Copy league link' });
  });
});

describe('InviteCodeBox and SettingsForm', () => {
  it('renders the code input', () => {
    expect(render(h(InviteCodeBox, {}))).toContain('Have an invite code?');
  });
  it('renders the settings fields and the danger zone', () => {
    const out = render(h(SettingsForm, { profile: { displayName: 'Joey', frcTeam: 5181 } }));
    expect(out).toContain('value="Joey"');
    expect(out).toContain('value="5181"');
    expect(out).toContain('Sign out');
    expect(out).toContain('Delete account');
    expect(out).toContain('Shown in every league. You can also set a different name inside a league from its ⋯ menu.');
  });
  it('InviteCodeBox input has keyboard attributes for codes', () => {
    const html = render(h(InviteCodeBox, {}));
    expect(html).toContain('name="code"');
    expect(html).toContain('spellCheck="false"');
    expect(html).toContain('autoCorrect="off"');
    expect(html).toContain('autoCapitalize="characters"');
    expect(html).not.toContain('items-end');
  });
});
