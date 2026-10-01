import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AddManualRoundForm } from '@/components/admin/AddManualRoundForm';
import {
  fromDraft,
  ManualResultsEditor,
  orderResultRows,
  resultSummary,
  toDraft,
} from '@/components/admin/ManualResultsEditor';
import type { AdminRoundDetail } from '@/lib/api/types';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import type { ManualResult } from '@/lib/scoring/types';
import { mergePool } from '@/lib/teams';

const pool = mergePool(null, ['frc1', 'frc2', 'frc3', 'frc4']);
const full: ManualResult = {
  teamKey: 'frc2', qualWins: 7, qualLosses: 2, qualTies: 1, rankingPoints: 20, qualRank: 3,
  allianceRole: 'captain', playoffWins: 4, eventResult: 'winner', awardTypes: [0],
};

describe('orderResultRows', () => {
  it('lists drafted teams in pick order, and everyone else only when asked', () => {
    const picks = [{ teamKey: 'frc3' }, { teamKey: 'frc1' }];
    expect(orderResultRows(pool, picks, false).map((t) => t.teamKey)).toEqual(['frc3', 'frc1']);
    expect(orderResultRows(pool, picks, true).map((t) => t.teamKey)).toEqual(['frc3', 'frc1', 'frc2', 'frc4']);
  });

  it('shows every team when nothing has been drafted yet', () => {
    expect(orderResultRows(pool, [], false)).toHaveLength(4);
  });
});

describe('resultSummary', () => {
  it('reads like a scoreboard line', () => {
    expect(resultSummary(full)).toBe('7-2-1 · #3 · Captain · Winner · 1 award');
    expect(resultSummary(undefined)).toBe('No result yet');
    expect(resultSummary({ ...full, qualRank: null, allianceRole: null, eventResult: null, awardTypes: [0, 9] })).toBe(
      '7-2-1 · 2 awards',
    );
  });
});

describe('toDraft / fromDraft', () => {
  it('round-trips a full result', () => {
    const { teamKey: _t, ...rest } = full;
    expect(fromDraft(toDraft(full))).toEqual(rest);
  });

  it('turns blanks into 0 for counts and null for rank and RP', () => {
    expect(fromDraft(toDraft(undefined))).toEqual({
      qualWins: 0, qualLosses: 0, qualTies: 0, rankingPoints: null, qualRank: null,
      allianceRole: null, playoffWins: 0, eventResult: null, awardTypes: [],
    });
  });

  it('sends -1 for text that is not a whole number, so the server explains the rule', () => {
    expect(fromDraft({ ...toDraft(undefined), qualWins: '2.5', qualRank: 'abc' })).toMatchObject({ qualWins: -1, qualRank: -1 });
  });
});

describe('ManualResultsEditor', () => {
  const detail = {
    round: { id: 'r1', kind: 'manual', scoring: DEFAULT_SCORING },
    pool,
    picks: [{ pickNumber: 0, playerId: 'p1', teamKey: 'frc2' }],
    manualResults: [full],
  } as unknown as AdminRoundDetail;
  const html = renderToStaticMarkup(
    h(ManualResultsEditor, { detail, busy: false, run: async () => {}, api: (async () => ({})) as never, playerNames: {} }),
  );

  it('starts with only drafted teams and a "Show all teams" button', () => {
    expect(html).toContain('Team 2');
    expect(html).not.toContain('Team 4');
    expect(html).toContain('Show all teams');
    expect(html).toContain('7-2-1 · #3 · Captain · Winner · 1 award');
  });
});

describe('AddManualRoundForm', () => {
  it('asks for a name and two dates', () => {
    const html = renderToStaticMarkup(h(AddManualRoundForm, { busy: false, saving: false, onAdd: async () => true }));
    for (const label of ['Event name', 'Start date', 'End date', 'Add manual event']) expect(html).toContain(label);
    expect(html).toContain('type="date"');
  });
});
