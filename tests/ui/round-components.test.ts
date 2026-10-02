import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdjustmentList } from '@/components/AdjustmentList';
import { DraftBoard } from '@/components/DraftBoard';
import { Freshness } from '@/components/Freshness';
import { StatusBadge } from '@/components/StatusBadge';
import { STATUS_LABEL, type RoundStatus } from '@/lib/rounds/status';
import type { PlayerRoundScore } from '@/lib/scoring/types';

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

/** Visible-ish text: tags stripped, entities decoded, whitespace collapsed. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('DraftBoard', () => {
  const draftOrder = ['p1', 'p2', 'p3'];
  const playerNames = { p1: 'Joey', p2: 'Mom', p3: 'Dad' };

  it('renders rosterSize × draftOrder.length cells with "—" for empty ones', () => {
    const picks = [
      { pickNumber: 0, playerId: 'p1', teamKey: 'frc5181' },
      { pickNumber: 1, playerId: 'p2', teamKey: 'frc341' },
    ];
    const html = render(h(DraftBoard, { picks, draftOrder, rosterSize: 2, playerNames, teamNames: {} }));
    expect(count(html, '<li')).toBe(6);
    expect(count(html, '—')).toBe(4);
    const t = text(html);
    expect(t).toContain('Round 1');
    expect(t).toContain('Round 2');
    expect(t).toContain('5181');
    expect(t).toContain('341');
    // Snake order: pick #4 (first of round 2) belongs to the last player in the order.
    expect(t).toContain('#4 · Dad');
  });

  it('explains when there is no draft order', () => {
    const t = text(render(h(DraftBoard, { picks: [], draftOrder: [], rosterSize: 4, playerNames, teamNames: {} })));
    expect(t).toBe("The draft order hasn't been set yet.");
  });
});

describe('AdjustmentList', () => {
  it('shows the target, signed points and reason', () => {
    const t = text(
      render(
        h(AdjustmentList, {
          adjustments: [
            { id: 'a1', playerId: 'p2', teamKey: null, points: -5, reason: 'Late to the draft' },
            { id: 'a2', playerId: null, teamKey: 'frc5181', points: 5, reason: 'Industrial Design Award' },
          ],
          playerNames: { p2: 'Mom' },
          teamNames: { frc5181: 'Miracle Workerz' },
        }),
      ),
    );
    expect(t).toContain('Mom');
    expect(t).toContain('-5');
    expect(t).toContain('Late to the draft');
    expect(t).toContain('Team 5181 Miracle Workerz');
    expect(t).toContain('+5');
    expect(t).toContain('Industrial Design Award');
  });

  it('says so when there are none', () => {
    expect(text(render(h(AdjustmentList, { adjustments: [], playerNames: {}, teamNames: {} })))).toBe(
      'No adjustments.',
    );
  });
});

describe('StatusBadge', () => {
  it('shows the label for every status', () => {
    for (const status of Object.keys(STATUS_LABEL) as RoundStatus[]) {
      expect(text(render(h(StatusBadge, { status })))).toBe(STATUS_LABEL[status]);
    }
  });

  it('pulses only while live', () => {
    expect(render(h(StatusBadge, { status: 'live' }))).toContain('animate-pulse');
    expect(render(h(StatusBadge, { status: 'final' }))).not.toContain('animate-pulse');
  });
});

describe('Freshness', () => {
  const now = new Date('2026-10-24T15:10:00Z');

  it('renders the stale wording as a status alert', () => {
    const html = render(h(Freshness, { fetchedAt: '2026-10-24T15:00:00Z', stale: true, now }));
    expect(text(html)).toContain('Scores may be behind — last updated 10 min ago');
    expect(html).toContain('role="status"');
  });

  it('renders plain muted text when fresh', () => {
    const html = render(h(Freshness, { fetchedAt: '2026-10-24T15:09:30Z', stale: false, now }));
    expect(text(html)).toBe('Last updated just now');
    expect(html).not.toContain('role=');
  });
});
