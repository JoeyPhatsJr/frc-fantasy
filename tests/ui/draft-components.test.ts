import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConfirmSheet, confirmText, trappedFocusIndex } from '@/components/draft/ConfirmSheet';
import { bannerLines, DraftRoomBanner } from '@/components/draft/DraftRoomBanner';
import { DraftRosters } from '@/components/draft/DraftRosters';
import { PoolList } from '@/components/draft/PoolList';
import { QueueList } from '@/components/draft/QueueList';
import { LiveDraftControls } from '@/components/admin/LiveDraftControls';
import { LiveDraftBanner } from '@/components/draft/LiveDraftBanner';
import { DraftBoard } from '@/components/DraftBoard';
import type { AdminRoundDetail } from '@/lib/api/types';
import type { DraftState } from '@/lib/draft/state';
import type { PoolEntry } from '@/lib/pool/entries';

const text = (html: string) =>
  html.replace(/<[^>]+>/g, '').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const state = (over: Partial<DraftState> = {}): DraftState => ({
  phase: 'live', draftMode: 'live', pickNumber: 1, totalPicks: 6,
  onClock: { playerId: 'mom', name: 'Mom' }, deadline: '2026-10-23T23:01:00.000Z', serverNow: '2026-10-23T23:00:18.000Z',
  pickSeconds: 60, pausedRemainingMs: null,
  order: [{ playerId: 'joey', name: 'Joey' }, { playerId: 'mom', name: 'Mom' }, { playerId: 'dad', name: 'Dad' }],
  rosterSize: 2, picks: [{ pickNumber: 0, playerId: 'joey', teamKey: 'frc341', auto: false }], autodraftPlayerIds: [],
  ...over,
});
const entry = (teamKey: string, proj: number | null, nickname = 'Team'): PoolEntry => ({
  teamKey, nickname, proj, record: null, bestFinish: null, opr: null, rank: null, available: true,
});

describe('bannerLines (§7.6)', () => {
  it('names who is on the clock with the countdown, and how far away my turn is', () => {
    expect(bannerLines(state(), 42_000, 'dad')).toEqual({
      main: 'On the clock: Mom', clock: '0:42', sub: "You're up in 1 pick", urgent: false,
    });
    expect(bannerLines(state(), 42_000, 'joey').sub).toBe("You're up in 4 picks");
    expect(bannerLines(state(), 9_000, 'mom')).toMatchObject({ sub: 'Your pick!', urgent: true });
    expect(bannerLines(state({ pickSeconds: null, deadline: null }), null, null)).toMatchObject({ clock: null, sub: null });
  });
  it('covers setup, paused, and done', () => {
    expect(bannerLines(state({ phase: 'setup', onClock: null }), null, 'mom').main).toBe(
      'Waiting for the commissioner to start the draft',
    );
    expect(bannerLines(state({ phase: 'paused', pausedRemainingMs: 30_000 }), null, 'mom')).toMatchObject({
      main: 'Paused by commissioner', clock: '0:30 left',
    });
    expect(bannerLines(state({ phase: 'done', onClock: null }), null, 'mom')).toMatchObject({ main: 'Draft complete', sub: null });
  });
  it('renders "On the clock: Mom · 0:42" and a Reconnecting line', () => {
    const html = renderToStaticMarkup(h(DraftRoomBanner, { state: state(), remainingMs: 42_000, meId: null, reconnecting: true }));
    expect(text(html)).toContain('On the clock: Mom · 0:42');
    expect(text(html)).toContain('Reconnecting…');
  });
});

describe('PoolList (§6.3)', () => {
  const entries = [entry('frc341', null, 'Miss Daisy'), entry('frc25', 12.5, 'Raider Robotix')];
  const props = {
    slug: 'habich-fam-abc234', roundId: '00000000-0000-4000-8000-000000000001',
    entries, taken: new Set<string>(), queued: new Set(['frc25']), canDraft: false, draftLabel: 'Draft',
    readOnly: false, queueDisabled: false, onDraft: () => {}, onToggleQueue: () => {},
  };
  it('shows a New chip for teams without a projection and Proj otherwise', () => {
    const t = text(renderToStaticMarkup(h(PoolList, props)));
    expect(t).toContain('New');
    expect(t).toContain('Proj 12.5');
    expect(t).toContain('Proj. uses standard scoring');
  });
  it('disables Draft when it is not my turn, and hides buttons for read-only viewers', () => {
    const html = renderToStaticMarkup(h(PoolList, props));
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Draft<\/button>/);
    expect(html).toContain('aria-label="Remove 25 from queue"');
    const ro = renderToStaticMarkup(h(PoolList, { ...props, readOnly: true }));
    expect(ro).not.toContain('>Draft<');
  });
  it('disables the queue buttons while a queue save is in flight (review M7)', () => {
    const queueButtons = (html: string) => html.match(/<button[^>]*aria-label="(Add|Remove) [^"]+ (to|from) queue"[^>]*>/g) ?? [];
    const idle = queueButtons(renderToStaticMarkup(h(PoolList, props)));
    expect(idle).toHaveLength(2);
    expect(idle.every((b) => !/ disabled=""/.test(b))).toBe(true);
    const saving = queueButtons(renderToStaticMarkup(h(PoolList, { ...props, queueDisabled: true })));
    expect(saving).toHaveLength(2);
    expect(saving.every((b) => / disabled=""/.test(b))).toBe(true);
  });
});

describe('QueueList', () => {
  it('lists queued teams in order, dropping taken ones', () => {
    const t = text(renderToStaticMarkup(h(QueueList, {
      queue: ['frc254', 'frc341', 'frc25'], teamNames: { frc25: 'Raider Robotix' }, taken: new Set(['frc341']),
      disabled: false, onChange: () => {},
    })));
    expect(t.indexOf('254')).toBeLessThan(t.indexOf('Raider Robotix'));
    expect(t).not.toContain('341');
  });
  it('explains itself when empty', () => {
    const t = text(renderToStaticMarkup(h(QueueList, { queue: [], teamNames: {}, taken: new Set<string>(), disabled: false, onChange: () => {} })));
    expect(t).toContain('Your queue is empty');
  });
});

describe('ConfirmSheet', () => {
  it('asks "Draft 341?" (with Proj when known) or "Pick 341 for Mom?"', () => {
    expect(confirmText(entry('frc341', null), null)).toBe('Draft 341?');
    expect(confirmText(entry('frc341', 38.2), null)).toBe('Draft 341 · Proj 38.2?');
    expect(confirmText(entry('frc341', null), 'Mom')).toBe('Pick 341 for Mom?');
    const html = renderToStaticMarkup(h(ConfirmSheet, { entry: entry('frc341', null), forName: null, busy: false, onConfirm: () => {}, onCancel: () => {} }));
    expect(html).toContain('role="dialog"');
    expect(text(html)).toContain('Draft 341?');
  });

  it('Tab and Shift+Tab cycle inside the sheet (review M9)', () => {
    // Two buttons: Cancel (0) and Draft (1).
    expect(trappedFocusIndex(0, 2, false)).toBe(1);
    expect(trappedFocusIndex(1, 2, false)).toBe(0); // Tab past the last wraps to the first
    expect(trappedFocusIndex(0, 2, true)).toBe(1); // Shift+Tab before the first wraps to the last
    expect(trappedFocusIndex(1, 2, true)).toBe(0);
    // Focus somewhere outside the sheet: come back in at the start (Tab) or end (Shift+Tab).
    expect(trappedFocusIndex(-1, 2, false)).toBe(0);
    expect(trappedFocusIndex(-1, 2, true)).toBe(1);
    // Nothing focusable (both buttons disabled while the pick is sending): stay put.
    expect(trappedFocusIndex(-1, 0, false)).toBe(-1);
  });
});

describe('DraftRosters and DraftBoard highlight', () => {
  it('lists each player with their teams', () => {
    const t = text(renderToStaticMarkup(h(DraftRosters, {
      order: state().order, picks: [{ pickNumber: 0, playerId: 'joey', teamKey: 'frc341', auto: true }], rosterSize: 2, teamNames: {},
    })));
    expect(t).toContain('Joey');
    expect(t).toContain('341');
    expect(t).toContain('auto');
    expect(t).toContain('Mom');
  });
  it('rings the newest pick on the board', () => {
    const html = renderToStaticMarkup(h(DraftBoard, {
      picks: [{ pickNumber: 0, playerId: 'joey', teamKey: 'frc341' }], draftOrder: ['joey', 'mom'], rosterSize: 1,
      playerNames: { joey: 'Joey', mom: 'Mom' }, teamNames: {}, highlightPick: 0,
    }));
    expect(html).toContain('data-newest="true"');
  });
});

describe('LiveDraftBanner', () => {
  it('links members to the draft room', () => {
    const html = renderToStaticMarkup(h(LiveDraftBanner, { slug: 'fam', drafts: [{ roundId: 'r1', eventName: 'Ramp Riot', phase: 'live' }] }));
    expect(html).toContain('href="/l/fam/r/r1/draft"');
    expect(text(html)).toContain('Draft is live — join');
    expect(renderToStaticMarkup(h(LiveDraftBanner, { slug: 'fam', drafts: [] }))).toBe('');
  });
});

describe('LiveDraftControls', () => {
  const detail = (over: Partial<AdminRoundDetail['round']>, draftPhase: AdminRoundDetail['draftPhase']) =>
    ({
      round: { id: 'r1', draftMode: 'live', pickSeconds: 60, draftStartedAt: null, draftPausedAt: null, ...over },
      draftPhase,
      picks: [],
    }) as unknown as AdminRoundDetail;
  const props = (d: AdminRoundDetail) => ({ detail: d, busy: false, run: async () => {}, api: (async () => ({})) as never, playerNames: {}, slug: 'fam' });

  it('offers Start before the draft and Resume while paused', () => {
    expect(text(renderToStaticMarkup(h(LiveDraftControls, props(detail({}, 'setup')))))).toContain('Start draft');
    const paused = text(renderToStaticMarkup(h(LiveDraftControls, props(detail({ draftStartedAt: 'x', draftPausedAt: 'y' }, 'paused')))));
    expect(paused).toContain('Resume');
    expect(paused).not.toContain('Start draft');
  });
  it('hides the timer for commissioner-entered drafts', () => {
    const t = text(renderToStaticMarkup(h(LiveDraftControls, props(detail({ draftMode: 'commissioner' }, 'setup')))));
    expect(t).not.toContain('Pick timer');
    expect(t).not.toContain('Start draft');
  });
});
