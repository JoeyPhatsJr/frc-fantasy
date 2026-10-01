import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/' }));

import AdminPage from '@/app/l/[slug]/admin/page';
import { AdminDashboard, FIRST_ROUND_FAILED, leagueLinkLabels } from '@/components/admin/AdminDashboard';
import { afterCreateUrl, CreateLeagueForm } from '@/components/CreateLeagueForm';
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
    expect(out).toContain('To change your name in one league, open that league and use “You in this league”.');
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
