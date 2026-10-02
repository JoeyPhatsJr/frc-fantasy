import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InviteCard, shareOrCopy } from '@/components/admin/InviteCard';
import { EventPicker } from '@/components/admin/EventPicker';
import { RoundChecklistView, stepSummaries } from '@/components/admin/RoundChecklist';

const r = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('shareOrCopy', () => {
  it('uses the share sheet when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareOrCopy('https://x/join/AB', 'Join', { share })).toBe('shared');
    expect(share).toHaveBeenCalledWith({ url: 'https://x/join/AB', title: 'Join' });
  });
  it('falls back to copying', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareOrCopy('u', 't', { clipboard: { writeText } })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('u');
  });
  it('copies when sharing is cancelled, and reports failure with neither', async () => {
    const share = vi.fn().mockRejectedValue(new Error('AbortError'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareOrCopy('u', 't', { share, clipboard: { writeText } })).toBe('copied');
    expect(await shareOrCopy('u', 't', undefined)).toBe('failed');
  });
  it('reports failure when copying is blocked too', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    expect(await shareOrCopy('u', 't', { clipboard: { writeText } })).toBe('failed');
  });
});

describe('InviteCard', () => {
  it('shows the code big with Share link and Reset code', () => {
    const html = r(h(InviteCard, { leagueName: 'Family', code: 'K7Q2XP', onReset: () => {}, busy: false }));
    expect(html).toContain('K7Q2XP');
    expect(html).toContain('Share link');
    expect(html).toContain('Reset code');
    expect(html).toContain('font-display');
  });
  it('is the "Invite people" section, and Reset code is disabled while something runs', () => {
    const html = r(h(InviteCard, { leagueName: 'Family', code: 'K7Q2XP', onReset: () => {}, busy: true }));
    expect(html).toContain('Invite people');
    expect(html).toContain('Share this link, or tell people the code.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Reset code/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Share link/);
  });
});

describe('EventPicker', () => {
  it('lists upcoming events and an Other event field that accepts TBA links', () => {
    const html = r(h(EventPicker, { upcoming: [{ key: '2026parr', name: 'Ramp Riot', startDate: '2026-10-24', endDate: '2026-10-24' }], onPick: () => {}, busy: false }));
    expect(html).toContain('Ramp Riot');
    expect(html).toContain('Oct 24');
    expect(html).toContain('TBA link or event code');
  });
  it('shows at most 6 upcoming events, each with an Add button named for it', () => {
    const upcoming = Array.from({ length: 8 }, (_, i) => ({
      key: `2026e${i}`, name: `Event ${i}`, startDate: '2026-10-24', endDate: '2026-10-25',
    }));
    const html = r(h(EventPicker, { upcoming, onPick: () => {}, busy: false }));
    expect(html).toContain('Event 5');
    expect(html).not.toContain('Event 6');
    expect(html).toContain('aria-label="Add Event 0"');
    expect(html).toContain('Other event');
  });
  it('still offers the Other event field when there are no upcoming events (TBA down)', () => {
    const html = r(h(EventPicker, { upcoming: [], onPick: () => {}, busy: false }));
    expect(html).toContain('TBA link or event code (like 2025parr)');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>[^<]*Check<\/button>/);
  });
});

describe('stepSummaries', () => {
  it('one-line summaries for done steps and previews for future ones', () => {
    const s = stepSummaries({ playerCount: 6, rosterSize: 4, picks: 24, kind: 'tba', manualResults: 0, finalized: false });
    expect(s[1].summary).toBe('6 players · 4 teams each');
    expect(s[2].summary).toBe('Draft complete · 24 picks');
    expect(s[3].preview).toBe('Scores update from The Blue Alliance automatically. Fix anything with adjustments.');
    expect(s[4].summary).toBe('Not final yet');
    const manual = stepSummaries({ playerCount: 2, rosterSize: 3, picks: 6, kind: 'manual', manualResults: 5, finalized: true });
    expect(manual[3].summary).toBe('5 results entered');
    expect(manual[4].summary).toBe('Final');
  });
});

describe('RoundChecklistView', () => {
  const steps = ([1, 2, 3, 4] as const).map((step) => ({ step, summary: `sum${step}`, preview: `pre${step}`, content: `content${step}` }));
  it('numbers the steps, checks done ones, opens only the current step', () => {
    const html = r(h(RoundChecklistView, { current: 2, open: [2], steps, onToggle: () => {} }));
    for (const t of ['Set up', 'Run the draft', 'During the event', 'Wrap up']) expect(html).toContain(t);
    expect(html).toContain('sum1');
    expect(html).toContain('content2');
    expect(html).not.toContain('content3');
    expect(html).toContain('pre3');
    expect(html).toMatch(/aria-current="step"/);
    expect(html.match(/aria-expanded="true"/g)?.length).toBe(1);
  });
  it('any step can be opened', () => {
    expect(r(h(RoundChecklistView, { current: 2, open: [2, 4], steps, onToggle: () => {} }))).toContain('content4');
  });
});
