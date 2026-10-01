import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdjustmentList } from '@/components/AdjustmentList';
import { DraftBoard } from '@/components/DraftBoard';
import { Freshness } from '@/components/Freshness';
import { Leaderboard } from '@/components/Leaderboard';
import { RosterList, rostersHint } from '@/components/RosterList';
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

describe('Leaderboard', () => {
  const rows = [
    { id: 'a', rank: 1, name: 'Joey', total: 42, detail: '20 · 22' },
    { id: 'b', rank: 2, name: 'Mom', total: 30 },
    { id: 'c', rank: 3, name: 'Dad', total: 12 },
  ];

  it('renders ranks, names, totals and the detail line', () => {
    const html = render(h(Leaderboard, { rows, emptyText: 'Nobody yet' }));
    expect(count(html, '<li')).toBe(3);
    const t = text(html);
    for (const name of ['Joey', 'Mom', 'Dad']) expect(t).toContain(name);
    for (const total of ['42', '30', '12']) expect(t).toContain(total);
    expect(t).toContain('20 · 22');
    // Joey's row comes first and carries rank 1.
    expect(t.indexOf('Joey')).toBeLessThan(t.indexOf('Mom'));
    expect(t).toMatch(/1\s*Joey/);
  });

  it('shows the empty text when there are no rows', () => {
    const html = render(h(Leaderboard, { rows: [], emptyText: 'Nobody yet' }));
    expect(text(html)).toBe('Nobody yet');
    expect(html).not.toContain('<li');
  });
});

describe('RosterList', () => {
  const scores: PlayerRoundScore[] = [
    {
      playerId: 'p1',
      name: 'Grandpa With A Very Long Name Indeed',
      total: 16,
      rank: 1,
      teams: [
        {
          teamKey: 'frc5181',
          total: 21,
          lines: [
            { category: 'qualRecord', label: 'Qual record 7-2-0', points: 21 },
            { category: 'awards', label: 'Awards', points: 0 },
          ],
        },
        { teamKey: 'frc341', total: 0, lines: [{ category: 'rank', label: 'Rank 30', points: 0 }] },
      ],
      adjustments: [{ category: 'adjustment', label: 'Adjustment: Late to the draft', points: -5 }],
    },
    { playerId: 'p2', name: 'Mom', total: 0, rank: 2, teams: [], adjustments: [] },
  ];

  it('shows non-zero lines and hides zero-point lines', () => {
    const t = text(render(h(RosterList, { scores, teamNames: { frc5181: 'Miracle Workerz' }, draftInProgress: false })));
    expect(t).toContain('Qual record 7-2-0 → +21');
    expect(t).not.toContain('Awards');
    expect(t).not.toContain('Rank 30');
    expect(t).not.toContain('+0');
    expect(t).toContain('No points yet');
    expect(t).toContain('5181 Miracle Workerz — 21 pts');
    expect(t).toContain('Player adjustments');
    expect(t).toContain('Adjustment: Late to the draft → -5');
    expect(t).toContain('2 teams');
    expect(t).toContain('0 teams');
    expect(t).not.toContain('draft in progress');
  });

  it('says "draft in progress" for a pickless player while drafting', () => {
    const t = text(render(h(RosterList, { scores, teamNames: {}, draftInProgress: true })));
    expect(t).toContain('draft in progress');
    expect(t).toContain('2 teams');
  });

  it('uses <details> for tap-to-expand and shows the full name inside', () => {
    const html = render(h(RosterList, { scores, teamNames: {}, draftInProgress: false }));
    expect(count(html, '<details')).toBe(2);
    expect(count(html, 'Grandpa With A Very Long Name Indeed')).toBeGreaterThanOrEqual(2);
  });

  it('shows a message when there are no players', () => {
    const t = text(render(h(RosterList, { scores: [], teamNames: {}, draftInProgress: true })));
    expect(t).toBe('No players in this round yet.');
  });
});

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

describe('RosterList with season detail', () => {
  const scores: PlayerRoundScore[] = [
    {
      playerId: 'p1', name: 'Joey', total: 58, rank: 1, adjustments: [],
      teams: [{ teamKey: 'frc5181', total: 58, lines: [{ category: 'adjustment', label: 'Spirit', points: 5 }] }],
    },
  ];
  const season = {
    frc5181: {
      teamKey: 'frc5181',
      total: 53,
      events: [
        { eventKey: '2027paca', name: 'Chesapeake', startDate: '2027-03-05', endDate: '2027-03-07', total: 41, stale: false,
          lines: [{ category: 'qualRecord' as const, label: 'Qual record 9-3-0', points: 27 }] },
        { eventKey: '2027pahat', name: 'Hatboro-Horsham', startDate: '2027-03-13', endDate: '2027-03-15', total: 12, stale: false, lines: [] },
      ],
      next: { eventKey: '2027mrcmp', name: 'Mid-Atlantic Championship', startDate: '2027-04-08' },
    },
  };
  const t = text(render(h(RosterList, { scores, teamNames: {}, draftInProgress: false, season })));

  it('shows one row per event with its subtotal, then the event lines', () => {
    expect(t).toContain('Mar 5–7, 2027 · Chesapeake');
    expect(t).toContain('+41');
    expect(t).toContain('Qual record 9-3-0');
    expect(t).toContain('Mar 13–15, 2027 · Hatboro-Horsham');
  });

  it('keeps team adjustments and shows the next event', () => {
    expect(t).toContain('Spirit');
    expect(t).toContain('Next: Mid-Atlantic Championship · Apr 8, 2027');
  });
});

describe('rostersHint (SP2 final review, Minor 6)', () => {
  it('season rosters expand player, then event: the hint names what to tap', () => {
    expect(rostersHint(true)).toBe('Tap a player, then an event, to see where its points came from.');
  });
  it('event rounds expand only the player', () => {
    expect(rostersHint(false)).toBe('Tap a player to see where their points came from.');
  });
});
