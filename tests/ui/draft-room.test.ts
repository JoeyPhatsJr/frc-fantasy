import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  actionNotice,
  DRAFT_PANEL_ID,
  DRAFT_TABS_ID,
  UNDO_STALE_NOTICE,
  autodraftShown,
  confirmTarget,
  defaultDraftTab,
  draftTabs,
  MAX_QUEUE,
  submitPick,
  toggledQueue,
} from '@/components/draft/DraftRoom';
import { DraftApiError, type DraftApi } from '@/lib/draft/api';
import type { DraftState } from '@/lib/draft/state';
import type { PoolEntry } from '@/lib/pool/entries';
import { PageTabs, pageTabId } from '@/components/ui/PageTabs';

const state = (over: Partial<DraftState> = {}): DraftState => ({
  phase: 'live', draftMode: 'live', pickNumber: 3, totalPicks: 6,
  onClock: { playerId: 'mom', name: 'Mom' }, deadline: null, serverNow: '2026-10-23T23:00:00.000Z',
  pickSeconds: null, pausedRemainingMs: null,
  order: [{ playerId: 'joey', name: 'Joey' }, { playerId: 'mom', name: 'Mom' }, { playerId: 'dad', name: 'Dad' }],
  rosterSize: 2, picks: [], autodraftPlayerIds: [],
  ...over,
});
const me = (playerId: string, isCommissioner = false) => ({ playerId, isCommissioner, queue: [], autodraft: false });
const team: PoolEntry = {
  teamKey: 'frc341', nickname: 'Miss Daisy', proj: null, record: null, bestFinish: null, opr: null, rank: null, available: true,
};

describe('actionNotice (§7.6)', () => {
  it('stays quiet on stale and not_your_turn 409s: the refetch shows what changed', () => {
    expect(actionNotice(new DraftApiError(409, 'Draft changed in another tab — refresh', 'stale'), 'frc341')).toBeNull();
    expect(actionNotice(new DraftApiError(409, "It's not your turn", 'not_your_turn'), 'frc341')).toBeNull();
  });
  it('names the team when someone else just took it', () => {
    expect(actionNotice(new DraftApiError(409, 'That team was just taken', 'taken'), 'frc341')).toBe(
      '341 was just taken — pick again',
    );
  });
  it("shows the server's message for other API errors, including taken without a picked team", () => {
    expect(actionNotice(new DraftApiError(409, "The draft isn't running right now", 'not_live'), 'frc341')).toBe(
      "The draft isn't running right now",
    );
    expect(actionNotice(new DraftApiError(409, 'That team was just taken', 'taken'))).toBe('That team was just taken');
    expect(actionNotice(new DraftApiError(403, 'Only the commissioner can do that'))).toBe(
      'Only the commissioner can do that',
    );
  });
  it('a server error during an action still shows a short notice (review M4)', () => {
    expect(actionNotice(new DraftApiError(500, 'Something went wrong'), 'frc341')).toBe('Something went wrong');
    expect(actionNotice(new DraftApiError(503, 'The league database is asleep'))).toBe('The league database is asleep');
  });
  it('blames the connection for anything that is not an API answer', () => {
    expect(actionNotice(new TypeError('Failed to fetch'))).toBe(
      "Couldn't reach the server. Check your connection and try again.",
    );
  });
});

describe('toggledQueue', () => {
  it('adds a team to the end, or removes it if it is already queued', () => {
    expect(toggledQueue(['frc341', 'frc254'], 'frc1114')).toEqual(['frc341', 'frc254', 'frc1114']);
    expect(toggledQueue(['frc341', 'frc254', 'frc1114'], 'frc254')).toEqual(['frc341', 'frc1114']);
  });
  it(`refuses to grow past ${MAX_QUEUE} teams but still lets a full queue shrink`, () => {
    const full = Array.from({ length: MAX_QUEUE }, (_, i) => `frc${i + 1}`);
    expect(toggledQueue(full, 'frc9999')).toBeNull();
    expect(toggledQueue(full, 'frc1')).toHaveLength(MAX_QUEUE - 1);
  });
});

describe('confirmTarget: the pick a confirm sheet is for, frozen when it opens (review I2)', () => {
  it('my own turn: my pick at the current pick number', () => {
    expect(confirmTarget(state({ me: me('mom') }), team)).toEqual({ entry: team, pickNumber: 3, forName: null });
  });
  it('commissioner, someone else on the clock: "Pick for" them at the current pick number', () => {
    expect(confirmTarget(state({ me: me('joey', true) }), team)).toEqual({ entry: team, pickNumber: 3, forName: 'Mom' });
  });
  it('no target when it is not my turn, the draft is not live, or I am only watching', () => {
    expect(confirmTarget(state({ me: me('dad') }), team)).toBeNull();
    expect(confirmTarget(state({ me: me('mom'), phase: 'paused' }), team)).toBeNull();
    expect(confirmTarget(state({ me: me('joey', true), phase: 'paused' }), team)).toBeNull();
    expect(confirmTarget(state(), team)).toBeNull();
  });
  it('a clock that moves on while the sheet is open does not change the target', () => {
    const target = confirmTarget(state({ me: me('joey', true) }), team)!;
    // Mom's clock ran out; Dad (pick 4) is up now. The sheet still says Mom and sends pick 3.
    expect(confirmTarget(state({ me: me('joey', true), pickNumber: 4, onClock: { playerId: 'dad', name: 'Dad' } }), team))
      .toEqual({ entry: team, pickNumber: 4, forName: 'Dad' });
    expect(target).toEqual({ entry: team, pickNumber: 3, forName: 'Mom' });
  });
});

describe('submitPick sends the frozen pick number (review I2)', () => {
  const fakeApi = () => ({ pick: vi.fn(async () => ({})), pickFor: vi.fn(async () => ({})) });
  it('"Pick for" goes to the commissioner route with the pick number from when the sheet opened', async () => {
    const api = fakeApi();
    await submitPick(api as unknown as DraftApi, { entry: team, pickNumber: 3, forName: 'Mom' });
    expect(api.pickFor).toHaveBeenCalledWith(3, 'frc341');
    expect(api.pick).not.toHaveBeenCalled();
  });
  it('my own pick goes to the member route', async () => {
    const api = fakeApi();
    await submitPick(api as unknown as DraftApi, { entry: team, pickNumber: 3, forName: null });
    expect(api.pick).toHaveBeenCalledWith(3, 'frc341');
    expect(api.pickFor).not.toHaveBeenCalled();
  });
  it('if the clock moved, the server answers stale and the UI just refetches (no notice)', () => {
    expect(actionNotice(new DraftApiError(409, 'Draft changed in another tab — refresh', 'stale'), 'frc341')).toBeNull();
  });
  it('a stale Undo says so instead of doing nothing (final review M7)', () => {
    const stale = new DraftApiError(409, 'Draft changed in another tab — refresh', 'stale');
    expect(UNDO_STALE_NOTICE).toBe('The draft moved on — check the board and try again.');
    expect(actionNotice(stale, undefined, true)).toBe(UNDO_STALE_NOTICE);
    expect(actionNotice(stale)).toBeNull(); // picks, pause, resume: still silent
    // Other Undo failures keep their own message.
    expect(actionNotice(new DraftApiError(403, 'Only the commissioner can do that'), undefined, true)).toBe(
      'Only the commissioner can do that',
    );
  });
});

describe('autodraftShown: the optimistic auto-draft checkbox (review I4)', () => {
  it('shows the server value when nothing is pending', () => {
    expect(autodraftShown(false, null, 100)).toBe(false);
    expect(autodraftShown(true, null, 100)).toBe(true);
  });
  it('shows the tapped value right away, while the save is in flight', () => {
    expect(autodraftShown(false, { value: true, savedAt: null }, 100)).toBe(true);
  });
  it('keeps the tapped value until a state fetched after the save arrives, then the server wins', () => {
    const saved = { value: true, savedAt: 200 };
    expect(autodraftShown(false, saved, 150)).toBe(true); // old state, fetched before the save landed
    expect(autodraftShown(true, saved, 250)).toBe(true);
    expect(autodraftShown(false, saved, 250)).toBe(false); // e.g. an undo turned it off again since
  });
});

describe('draftTabs', () => {
  it('members get Pool · My queue · Board; watchers get Pool · Board; no Rosters tab', () => {
    expect(draftTabs(true, 0).map((t) => t.label)).toEqual(['Pool', 'My queue', 'Board']);
    expect(draftTabs(true, 3).map((t) => t.label)).toEqual(['Pool', 'My queue (3)', 'Board']);
    expect(draftTabs(false, 0).map((t) => t.key)).toEqual(['pool', 'board']);
  });
});
describe('defaultDraftTab', () => {
  it('opens the board once the draft is done', () => {
    expect(defaultDraftTab('done')).toBe('board');
    expect(defaultDraftTab('setup')).toBe('pool');
    expect(defaultDraftTab('live')).toBe('pool');
    expect(defaultDraftTab('paused')).toBe('pool');
  });
});

describe('draft room tabs label their panel (final review M10)', () => {
  it('each tab has an id and controls the panel; the panel id matches the active tab', () => {
    const html = renderToStaticMarkup(
      h(PageTabs, {
        label: 'Draft room', active: 'queue', onSelect: () => {}, idPrefix: DRAFT_TABS_ID, panelId: DRAFT_PANEL_ID,
        items: [{ key: 'pool', label: 'Pool' }, { key: 'queue', label: 'My queue' }, { key: 'board', label: 'Board' }],
      }),
    );
    for (const key of ['pool', 'queue', 'board']) expect(html).toContain(`id="${pageTabId(DRAFT_TABS_ID, key)}"`);
    expect(html.match(/aria-controls="draft-room-panel"/g)).toHaveLength(3);
    expect(html).toMatch(new RegExp(`id="${pageTabId(DRAFT_TABS_ID, 'queue')}" aria-selected="true"`));
    expect(pageTabId(DRAFT_TABS_ID, 'queue')).toBe('draft-room-tab-queue');
  });
});
