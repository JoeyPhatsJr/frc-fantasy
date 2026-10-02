import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UpNextCard, upNextCopy } from '@/components/home/UpNextCard';
import { LeagueRows } from '@/components/me/LeagueRows';
import { MySeason } from '@/components/you/MySeason';
import type { UpNextInput } from '@/lib/views/upNext';

const item = (o: Partial<UpNextInput>): UpNextInput => ({
  leagueSlug: 'fam', leagueName: 'Family', roundId: 'r1', eventName: 'Ramp Riot',
  startDate: '2026-10-24', endDate: '2026-10-24', status: 'upcoming', draftMode: 'live',
  draftPhase: 'done', myTurn: false, myRank: null, myPoints: null, winnerName: null, myTeams: [], ...o,
});
const r = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('upNextCopy', () => {
  it('live draft, my turn', () => {
    const c = upNextCopy({ kind: 'draft-live', item: item({ draftPhase: 'live', myTurn: true }) });
    expect(c.title).toBe('Your pick!');
    expect(c.eyebrow).toBe('UP NEXT · FAMILY');
    expect(c.action).toEqual({ label: 'Open draft room', href: '/l/fam/r/r1/draft' });
  });
  it('live draft, someone else / paused', () => {
    expect(upNextCopy({ kind: 'draft-live', item: item({ draftPhase: 'live' }) }).title).toBe('Draft is live');
    expect(upNextCopy({ kind: 'draft-live', item: item({ draftPhase: 'paused' }) }).title).toBe('Draft paused');
  });
  it('live event with and without a rank', () => {
    const c = upNextCopy({ kind: 'event-live', item: item({ status: 'live', myRank: 2, myPoints: 198 }) });
    expect(c.title).toBe("You're 2nd at Ramp Riot");
    expect(c.detail).toBe('198 pts · Family');
    expect(c.action).toEqual({ label: 'See scores', href: '/l/fam/r/r1' });
    expect(upNextCopy({ kind: 'event-live', item: item({ status: 'live' }) }).title).toBe('Ramp Riot is live');
  });
  it('results with a medal for the podium', () => {
    const c = upNextCopy({ kind: 'results', item: item({ status: 'final', myRank: 1, winnerName: 'Joey' }) });
    expect(c.title).toBe('You finished 1st at Ramp Riot 🥇');
    expect(c.detail).toBe('Joey won · Family');
    expect(upNextCopy({ kind: 'results', item: item({ status: 'final', myRank: 4, winnerName: 'Mom' }) }).title).toBe('You finished 4th at Ramp Riot');
    expect(upNextCopy({ kind: 'results', item: item({ status: 'final', winnerName: 'Mom' }) }).title).toBe('Ramp Riot is final');
  });
  it('event soon and draft soon', () => {
    expect(upNextCopy({ kind: 'event-soon', item: item({}) }).title).toBe('Ramp Riot starts Oct 24');
    const d = upNextCopy({ kind: 'draft-soon', item: item({ status: 'setup', draftPhase: 'setup' }) });
    expect(d.title).toBe('Ramp Riot draft coming up');
    expect(d.detail).toBe('Oct 24 · Family');
    expect(d.action?.href).toBe('/l/fam/r/r1/draft');
    expect(d.action?.label).toBe('Open draft room');
  });
  it('hand-entered drafts point at the board, not a room (final review M5)', () => {
    const soon = upNextCopy({ kind: 'draft-soon', item: item({ status: 'setup', draftPhase: 'setup', draftMode: 'commissioner' }) });
    expect(soon.action).toEqual({ label: 'See the draft board', href: '/l/fam/r/r1/draft' });
    const live = upNextCopy({ kind: 'draft-live', item: item({ status: 'drafting', draftPhase: 'live', draftMode: 'commissioner' }) });
    expect(live.action).toEqual({ label: 'See the draft board', href: '/l/fam/r/r1/draft' });
  });
});

describe('UpNextCard', () => {
  it('renders the empty state when there is nothing', () => {
    expect(r(h(UpNextCard, { next: null }))).toContain('Nothing on right now');
  });
  it('shows your teams as blue plates for an upcoming event', () => {
    const html = r(h(UpNextCard, { next: { kind: 'event-soon', item: item({ myTeams: ['frc5181', 'frc2539'] }) } }));
    expect(html).toContain('Team 5181');
    expect(html).toContain('Team 2539');
    expect(html).not.toContain('bg-red-alliance');
  });
});

describe('LeagueRows', () => {
  it('links each league with its status line and rank', () => {
    const html = r(h(LeagueRows, { leagues: [
      { slug: 'fam', name: 'Family', isCommissioner: true, rank: 2, total: 198, line: 'Ramp Riot · live now', error: false },
      { slug: 'x', name: 'Broken', isCommissioner: false, rank: null, total: 0, line: "Couldn't load", error: true },
    ] }));
    expect(html).toContain('href="/l/fam"');
    expect(html).toContain('Ramp Riot · live now');
    expect(html).toContain('#2');
    expect(html).toContain('Commissioner');
    expect(html).toContain('Couldn&#x27;t load');
    expect(html).not.toContain('href="/l/x"');
  });
  it('puts the Commissioner badge on the status line, outside the name that gets cut off (final review M4)', () => {
    const html = r(h(LeagueRows, { leagues: [
      { slug: 'fam', name: 'The Extremely Long Habich Family Fantasy League', isCommissioner: true, rank: 1, total: 9, line: 'Ramp Riot · drafting', error: false },
    ] }));
    // Row's title span is the one that cuts off long text; the badge must not be inside it.
    const title = html.match(/<span class="block truncate text-\[15px\][^"]*">([\s\S]*?)<\/span>/)?.[1] ?? '';
    expect(title).toBe('The Extremely Long Habich Family Fantasy League');
    expect(html).toMatch(/Commissioner<\/span>Ramp Riot · drafting/);
    expect(r(h(LeagueRows, { leagues: [
      { slug: 'x', name: 'Other', isCommissioner: false, rank: 2, total: 1, line: 'Ramp Riot · drafting', error: false },
    ] }))).not.toContain('Commissioner');
  });
});

describe('MySeason', () => {
  it('labels every number', () => {
    const html = r(h(MySeason, { year: '2026', season: { total: 1284, bestPick: { teamKey: 'frc341', eventName: 'Ramp Riot', points: 62 }, averageFinish: 2.3 } }));
    expect(html).toContain('1,284');
    expect(html).toContain('points in 2026');
    expect(html).toContain('Best pick');
    expect(html).toContain('341 at Ramp Riot');
    expect(html).toContain('Average finish');
  });
});
