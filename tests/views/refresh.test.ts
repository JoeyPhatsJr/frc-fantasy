import { describe, expect, it } from 'vitest';
import { awaitingLiveDraft, DRAFT_WAIT_REFRESH_SECONDS, homeRefreshSeconds } from '@/lib/views/refresh';
import type { UpNextInput } from '@/lib/views/upNext';

const item = (o: Partial<UpNextInput>): UpNextInput => ({
  leagueSlug: 'fam', leagueName: 'Family', roundId: 'r1', eventName: 'Ramp Riot',
  startDate: '2026-10-24', endDate: '2026-10-24', status: 'setup', draftMode: 'live',
  draftPhase: 'setup', myTurn: false, myRank: null, myPoints: null, winnerName: null, myTeams: [], ...o,
});

describe('awaitingLiveDraft (Standings refresh, spec §5.5)', () => {
  it('is true while a live-mode round is in setup or drafting', () => {
    expect(awaitingLiveDraft([{ status: 'setup', draftMode: 'live' }])).toBe(true);
    expect(awaitingLiveDraft([{ status: 'final', draftMode: 'live' }, { status: 'drafting', draftMode: 'live' }])).toBe(true);
  });
  it('is false for hand-entered drafts and for rounds past the draft', () => {
    expect(awaitingLiveDraft([{ status: 'setup', draftMode: 'commissioner' }])).toBe(false);
    expect(awaitingLiveDraft([{ status: 'upcoming', draftMode: 'live' }, { status: 'live', draftMode: 'live' }])).toBe(false);
    expect(awaitingLiveDraft([])).toBe(false);
  });
});

describe('homeRefreshSeconds (Home and Leagues)', () => {
  it('refreshes every 30 s while a live draft is coming up', () => {
    expect(DRAFT_WAIT_REFRESH_SECONDS).toBe(30);
    expect(homeRefreshSeconds({ kind: 'draft-soon', item: item({}) })).toBe(30);
  });
  it('leaves a hand-entered draft alone', () => {
    expect(homeRefreshSeconds({ kind: 'draft-soon', item: item({ draftMode: 'commissioner' }) })).toBeNull();
  });
  it('keeps the 60 s refresh for live events and running drafts', () => {
    expect(homeRefreshSeconds({ kind: 'event-live', item: item({ status: 'live' }) })).toBe(60);
    expect(homeRefreshSeconds({ kind: 'draft-live', item: item({ status: 'drafting', draftPhase: 'live' }) })).toBe(60);
  });
  it('does nothing otherwise', () => {
    expect(homeRefreshSeconds(null)).toBeNull();
    expect(homeRefreshSeconds({ kind: 'event-soon', item: item({ status: 'upcoming' }) })).toBeNull();
    expect(homeRefreshSeconds({ kind: 'results', item: item({ status: 'final' }) })).toBeNull();
  });
});
