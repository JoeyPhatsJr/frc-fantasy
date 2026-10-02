import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdjustmentList } from '@/components/AdjustmentList';
import { EventSwitcher, EventSwitcherView } from '@/components/event/EventSwitcher';
import { PlayerBoard, seasonEventLabel } from '@/components/event/PlayerBoard';
import { ScoringSheet, ScoringSheetView } from '@/components/event/ScoringSheet';
import { EventList } from '@/components/standings/EventList';
import { SeasonBoard, seasonProgress } from '@/components/standings/SeasonBoard';
import type { PlayerRoundScore } from '@/lib/scoring/types';

const p = (playerId: string, name: string, rank: number, total: number, teams: string[] = []): PlayerRoundScore => ({
  playerId, name, rank, total, adjustments: [],
  teams: teams.map((teamKey, i) => ({ teamKey, total: 10 * (i + 1), lines: [{ category: 'qualRecord', label: 'Qual wins', points: 10 * (i + 1) }] })),
});
const scores = [p('a', 'Mom', 1, 212, ['frc254']), p('b', 'Joey', 2, 198, ['frc5181', 'frc2539']), p('c', 'Grandpa (left)', 3, 150)];
const r = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('PlayerBoard', () => {
  it('one row per player with rank and points; yours is open and highlighted', () => {
    const html = r(h(PlayerBoard, { scores, meId: 'b', teamNames: { frc5181: 'Bagel Bytes' }, status: 'live', season: null }));
    expect(html.match(/<details/g)?.length).toBe(3);
    expect(html).toMatch(/<details[^>]*open=""[^>]*>[\s\S]*Joey/);
    expect(html).toContain('(you)');
    expect(html).toContain('212');
    expect(html).toContain('Team 5181');
    expect(html).toContain('Bagel Bytes');
  });
  it('never highlights anyone for a signed-out viewer', () => {
    const html = r(h(PlayerBoard, { scores, meId: null, teamNames: {}, status: 'live', season: null }));
    expect(html).not.toContain('(you)');
    expect(html).not.toContain(' open=""');
    expect(html).not.toContain('var(--color-primary-fill)');
  });
  it('shows dashes instead of zeros before the event', () => {
    const html = r(h(PlayerBoard, { scores: [p('a', 'Mom', 1, 0, ['frc254'])], meId: null, teamNames: {}, status: 'upcoming', season: null }));
    expect(html).toContain('—');
  });
  it('a player with no teams says so', () => {
    expect(r(h(PlayerBoard, { scores, meId: null, teamNames: {}, status: 'live', season: null }))).toContain('No teams yet');
  });
  it('plates are blue', () => {
    expect(r(h(PlayerBoard, { scores, meId: 'b', teamNames: {}, status: 'live', season: null }))).not.toContain('bg-red-alliance');
  });
});

describe('PlayerBoard details', () => {
  it('hides zero-point lines and shows the breakdown in plain words', () => {
    const s: PlayerRoundScore = {
      playerId: 'a', name: 'Mom', rank: 1, total: 21,
      teams: [{ teamKey: 'frc254', total: 21, lines: [
        { category: 'qualRecord', label: 'Qual record 7-0-0', points: 21 },
        { category: 'awards', label: 'Awards', points: 0 },
      ] }],
      adjustments: [{ category: 'adjustment', label: 'Adjustment: Late to the draft', points: -5 }],
    };
    const html = r(h(PlayerBoard, { scores: [s], meId: null, teamNames: {}, status: 'live', season: null }));
    expect(html).toContain('Qual record 7-0-0 → +21');
    expect(html).not.toContain('Awards');
    expect(html).toContain('Adjustment: Late to the draft → -5');
    expect(html).not.toContain('Adjustment: Adjustment:');
  });
  it('season rounds list each team’s events and its next event', () => {
    const s = p('a', 'Mom', 1, 41, ['frc5181']);
    const season = {
      frc5181: {
        teamKey: 'frc5181', total: 41,
        events: [{ eventKey: '2027paca', name: 'Chesapeake', startDate: '2027-03-05', endDate: '2027-03-07', total: 41, stale: false,
          lines: [{ category: 'qualRecord' as const, label: 'Qual record 9-3-0', points: 27 }] }],
        next: { eventKey: '2027mrcmp', name: 'Mid-Atlantic Championship', startDate: '2027-04-08' },
      },
    };
    const html = r(h(PlayerBoard, { scores: [s], meId: null, teamNames: {}, status: 'live', season }));
    expect(html).toContain('Mar 5–7, 2027 · Chesapeake');
    expect(html).toContain('+41');
    expect(html).toContain('Next: Mid-Atlantic Championship · Apr 8');
    expect(html.match(/<details/g)?.length).toBe(1);
  });
  it('says so when nobody is in the round', () => {
    expect(r(h(PlayerBoard, { scores: [], meId: null, teamNames: {}, status: 'setup', season: null }))).toContain('No players in this round yet.');
  });
});

describe('seasonEventLabel', () => {
  it('dates then name', () => {
    const e = { eventKey: 'k', name: 'Chesapeake', startDate: '2027-03-05', endDate: '2027-03-07', total: 0, lines: [], stale: false };
    expect(seasonEventLabel(e)).toBe('Mar 5–7, 2027 · Chesapeake');
  });
});

describe('EventSwitcher', () => {
  const rounds = [
    { id: 'r1', eventName: 'Ramp Riot', startDate: '2026-10-24' },
    { id: 'r2', eventName: 'Brunswick Eruption', startDate: '2026-11-07' },
  ];
  it('a chip naming the current event; the sheet lists rounds and the TBA link', () => {
    const closed = r(h(EventSwitcherView, { slug: 'a b', currentId: 'r1', currentName: 'Ramp Riot', rounds, tbaUrl: null, open: false, onOpen: () => {}, onClose: () => {} }));
    expect(closed).toContain('aria-haspopup="dialog"');
    expect(closed).toContain('Ramp Riot');
    expect(closed).not.toContain('Brunswick Eruption');
    const open = r(h(EventSwitcherView, { slug: 'a b', currentId: 'r1', currentName: 'Ramp Riot', rounds, tbaUrl: 'https://www.thebluealliance.com/event/2026parr', open: true, onOpen: () => {}, onClose: () => {} }));
    expect(open).toContain('Events');
    expect(open).toContain('href="/l/a%20b/r/r2"');
    expect(open).toContain('Nov 7');
    expect(open).toContain('href="https://www.thebluealliance.com/event/2026parr"');
    expect(open).toContain('rel="noopener noreferrer"');
    expect(open).toContain('(opens in a new tab)');
    expect(open).toContain('View on The Blue Alliance');
  });
  it('renders nothing with one round and no TBA link', () => {
    const html = r(h(EventSwitcher, { slug: 's', currentId: 'r1', currentName: 'Ramp Riot', rounds: rounds.slice(0, 1), tbaUrl: null }));
    expect(html).toContain('Ramp Riot');
    expect(html).not.toContain('aria-haspopup');
    expect(html).not.toContain('<button');
    expect(r(h(EventSwitcher, { slug: 's', currentId: 'r1', currentName: 'Ramp Riot', rounds: rounds.slice(0, 1), tbaUrl: 'https://x' }))).toContain('Ramp Riot');
  });
});

describe('ScoringSheet', () => {
  it('a "How scoring works" button whose sheet lists the lines', () => {
    expect(r(h(ScoringSheet, { lines: ['Each qualification win: 3 pts'] }))).toContain('How scoring works');
    const open = r(h(ScoringSheetView, { lines: ['Each qualification win: 3 pts', 'Each tie: 1 pt'], open: true, onOpen: () => {}, onClose: () => {} }));
    expect(open).toContain('role="dialog"');
    expect(open.match(/<li/g)?.length).toBe(2);
    expect(open).toContain('Each tie: 1 pt');
  });
});

describe('AdjustmentList rows', () => {
  it('reason as title, target as subtitle, signed points', () => {
    const html = r(h(AdjustmentList, {
      adjustments: [{ id: 'a1', playerId: null, teamKey: 'frc5181', points: 5, reason: 'Spirit' }],
      playerNames: {}, teamNames: { frc5181: 'Bagel Bytes' },
    }));
    expect(html).toContain('Spirit');
    expect(html).toContain('Team 5181 Bagel Bytes');
    expect(html).toContain('+5');
    expect(html).toContain('border-b border-border');
  });
});

describe('seasonProgress', () => {
  it('counts events left', () => {
    expect(seasonProgress([])).toBe('No events yet');
    expect(seasonProgress([{ status: 'final' }, { status: 'live' }, { status: 'upcoming' }])).toBe('3 events · 2 to go');
    expect(seasonProgress([{ status: 'upcoming' }])).toBe('1 event · 1 to go');
    expect(seasonProgress([{ status: 'final' }, { status: 'final' }])).toBe('Season over');
  });
  it('waits on final results while any finished event is still awaiting final', () => {
    expect(seasonProgress([{ status: 'final' }, { status: 'awaiting_final' }])).toBe('All events done · waiting on final results');
    expect(seasonProgress([{ status: 'awaiting_final' }])).toBe('All events done · waiting on final results');
  });
});

describe('SeasonBoard', () => {
  const standings = [
    { playerId: 'a', name: 'Mom', total: 400, rank: 1, perRound: [212, 188] },
    { playerId: 'b', name: 'Joey', total: 390, rank: 2, perRound: [198, 192] },
  ];
  const rounds = [{ id: 'r1', eventName: 'Ramp Riot', status: 'final' as const }, { id: 'r2', eventName: 'Brunswick Eruption', status: 'live' as const }];
  it('expands each player to a per-event breakdown by name', () => {
    const html = r(h(SeasonBoard, { standings, rounds, meId: 'b' }));
    expect(html).toContain('Ramp Riot');
    expect(html).toContain('Brunswick Eruption');
    expect(html).toContain('198');
    expect(html).not.toContain('Small numbers are points per round');
    expect(html).toMatch(/<details[^>]*open=""[^>]*>[\s\S]*Joey/);
  });
  it('marks you, tags final and live events, and highlights nobody when signed out', () => {
    const html = r(h(SeasonBoard, { standings, rounds, meId: 'b' }));
    expect(html).toContain('Joey (you)');
    expect(html).not.toContain('Mom (you)');
    expect(html).toContain('Final');
    expect(html).toContain('Live');
    expect(html).toContain('400');
    const out = r(h(SeasonBoard, { standings, rounds, meId: null }));
    expect(out).not.toContain('(you)');
    expect(out).not.toContain(' open=""');
  });
});

describe('EventList', () => {
  it('links every event and shows your rank there', () => {
    const html = r(h(EventList, { slug: 'fam', rounds: [{ id: 'r1', eventName: 'Ramp Riot', startDate: '2026-10-24', endDate: '2026-10-24', status: 'final', myRank: 2 }] }));
    expect(html).toContain('href="/l/fam/r/r1"');
    expect(html).toContain('You: 2nd');
  });
  it('leaves the rank off when you have none, and encodes the slug', () => {
    const html = r(h(EventList, { slug: 'a b', rounds: [{ id: 'r1', eventName: 'Ramp Riot', startDate: '2026-10-24', endDate: '2026-10-25', status: 'upcoming', myRank: null }] }));
    expect(html).toContain('href="/l/a%20b/r/r1"');
    expect(html).not.toContain('You:');
    expect(html).toContain('Oct 24–25, 2026');
    expect(html).toContain('Upcoming');
  });
});
