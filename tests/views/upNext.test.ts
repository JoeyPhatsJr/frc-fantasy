import { describe, expect, it } from 'vitest';
import { leagueStatusLine, upNext, type UpNextInput } from '@/lib/views/upNext';

const item = (o: Partial<UpNextInput>): UpNextInput => ({
  leagueSlug: 'fam', leagueName: 'Family', roundId: 'r', eventName: 'Ramp Riot',
  startDate: '2026-10-24', endDate: '2026-10-24', status: 'upcoming', draftMode: 'live',
  draftPhase: 'done', myTurn: false, myRank: null, myPoints: null, winnerName: null, myTeams: [], ...o,
});
const TODAY = '2026-10-20';

describe('upNext', () => {
  it('is null with nothing going on', () => {
    expect(upNext([], TODAY)).toBeNull();
    expect(upNext([item({ status: 'final', endDate: '2026-01-01' })], TODAY)).toBeNull();
  });
  it('a live draft beats everything, and my turn beats other live drafts', () => {
    const items = [
      item({ roundId: 'live', status: 'live' }),
      item({ roundId: 'd1', leagueName: 'A', status: 'drafting', draftPhase: 'live' }),
      item({ roundId: 'd2', leagueName: 'B', status: 'drafting', draftPhase: 'live', myTurn: true }),
    ];
    expect(upNext(items, TODAY)).toEqual({ kind: 'draft-live', item: items[2] });
  });
  it('a paused draft still counts as a live draft', () => {
    const i = item({ status: 'drafting', draftPhase: 'paused' });
    expect(upNext([i], TODAY)?.kind).toBe('draft-live');
  });
  it('a live event beats recent results and upcoming events', () => {
    const items = [item({ roundId: 'u' }), item({ roundId: 'f', status: 'final', endDate: '2026-10-19' }), item({ roundId: 'l', status: 'live' })];
    expect(upNext(items, TODAY)?.item.roundId).toBe('l');
  });
  it('shows results for 3 days after the event ends, most recent first', () => {
    const a = item({ roundId: 'a', status: 'final', endDate: '2026-10-17' });
    const b = item({ roundId: 'b', status: 'awaiting_final', endDate: '2026-10-18' });
    expect(upNext([a, b], TODAY)).toEqual({ kind: 'results', item: b });
    expect(upNext([item({ status: 'final', endDate: '2026-10-16' })], TODAY)).toBeNull();
  });
  it('then the soonest upcoming event, then the soonest draft to come', () => {
    const later = item({ roundId: 'later', startDate: '2026-11-01', endDate: '2026-11-01' });
    const sooner = item({ roundId: 'sooner', startDate: '2026-10-25', endDate: '2026-10-25' });
    expect(upNext([later, sooner], TODAY)).toEqual({ kind: 'event-soon', item: sooner });
    const setup = item({ roundId: 's', status: 'setup', draftPhase: 'setup' });
    expect(upNext([setup], TODAY)).toEqual({ kind: 'draft-soon', item: setup });
  });
  it('ignores drafts for events that already ended', () => {
    expect(upNext([item({ status: 'setup', draftPhase: 'setup', endDate: '2026-10-01' })], TODAY)).toBeNull();
  });
  it('breaks ties by start date, then league name', () => {
    const b = item({ roundId: 'b', leagueName: 'B', status: 'live' });
    const a = item({ roundId: 'a', leagueName: 'A', status: 'live' });
    expect(upNext([b, a], TODAY)?.item.roundId).toBe('a');
  });
});

describe('leagueStatusLine', () => {
  it('says what the most relevant round is doing', () => {
    expect(leagueStatusLine(null)).toBe('No events yet');
    expect(leagueStatusLine({ eventName: 'Ramp Riot', status: 'setup', startDate: '2026-10-24' })).toBe('Ramp Riot · draft not set up');
    expect(leagueStatusLine({ eventName: 'Ramp Riot', status: 'drafting', startDate: '2026-10-24' })).toBe('Ramp Riot · drafting');
    expect(leagueStatusLine({ eventName: 'Ramp Riot', status: 'upcoming', startDate: '2026-10-24' })).toBe('Ramp Riot · starts Oct 24');
    expect(leagueStatusLine({ eventName: 'Ramp Riot', status: 'live', startDate: '2026-10-24' })).toBe('Ramp Riot · live now');
    expect(leagueStatusLine({ eventName: 'Ramp Riot', status: 'awaiting_final', startDate: '2026-10-24' })).toBe('Ramp Riot · event over');
    expect(leagueStatusLine({ eventName: 'Ramp Riot', status: 'final', startDate: '2026-10-24' })).toBe('Ramp Riot · final');
  });
});
