import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PoolFilterFields, poolFilterLabel, samePoolFilter } from '@/components/PoolFilterFields';
import { RoundSetup } from '@/components/admin/RoundSetup';
import type { AdminRoundDetail } from '@/lib/api/types';
import { defaultScoring } from '@/lib/scoring/config';

describe('poolFilterLabel', () => {
  it('describes each filter in words', () => {
    expect(poolFilterLabel({ type: 'all' })).toBe('All teams');
    expect(poolFilterLabel({ type: 'district', key: '2027fma' })).toBe('District 2027fma');
    expect(poolFilterLabel({ type: 'state', country: 'USA', state: 'Pennsylvania' })).toBe('Pennsylvania, USA');
    expect(poolFilterLabel({ type: 'country', country: 'Canada' })).toBe('Canada');
  });
});

describe('samePoolFilter', () => {
  it('ignores key order (Postgres jsonb reorders keys)', () => {
    expect(
      samePoolFilter({ type: 'state', country: 'USA', state: 'Pennsylvania' }, JSON.parse('{"type":"state","state":"Pennsylvania","country":"USA"}')),
    ).toBe(true);
    expect(samePoolFilter({ type: 'country', country: 'USA' }, { type: 'country', country: 'Canada' })).toBe(false);
    expect(samePoolFilter({ type: 'all' }, { type: 'country', country: 'USA' })).toBe(false);
  });
});

describe('PoolFilterFields', () => {
  it('shows the right inputs for a state filter', () => {
    const html = renderToStaticMarkup(
      h(PoolFilterFields, { year: 2027, value: { type: 'state', country: 'USA', state: 'Pennsylvania' }, onChange: () => {} }),
    );
    for (const s of ['Which teams', 'Country', 'State or province', 'value="Pennsylvania"']) expect(html).toContain(s);
  });

  it('shows only the type picker for all teams, and a loading line for districts', () => {
    const all = renderToStaticMarkup(h(PoolFilterFields, { year: 2027, value: { type: 'all' }, onChange: () => {} }));
    expect(all).toContain('Which teams');
    expect(all).not.toContain('Country');
    const district = renderToStaticMarkup(
      h(PoolFilterFields, { year: 2027, value: { type: 'district', key: '' }, onChange: () => {} }),
    );
    expect(district).toContain('Loading districts…');
  });
});

describe('RoundSetup for a season round', () => {
  const detail = (over: Partial<AdminRoundDetail>, round: Partial<AdminRoundDetail['round']> = {}) =>
    ({
      round: {
        id: 'r1', kind: 'season', seasonYear: 2027, poolFilter: null, rosterSize: 8, draftOrder: [],
        draftStartedAt: null, scoring: defaultScoring(), ...round,
      },
      players: [],
      pool: [],
      poolStale: false,
      poolEmptyMessage: null,
      picks: [],
      ...over,
    }) as unknown as AdminRoundDetail;
  const render = (d: AdminRoundDetail) =>
    renderToStaticMarkup(
      h(RoundSetup, { detail: d, busy: false, run: async () => {}, api: (async () => ({})) as never, playerNames: {} }),
    );

  it('shows the pool filter, the empty-pool message, and rosters up to 15', () => {
    const html = render(detail({ poolEmptyMessage: "TBA hasn't published 2027 teams yet — usually by January." }));
    for (const s of ['Team pool', 'Which teams', 'Save team pool', 'Teams added by hand', '<option value="15">15</option>']) {
      expect(html).toContain(s);
    }
    expect(html).toContain('TBA hasn&#x27;t published 2027 teams yet — usually by January.');
    expect(html).not.toContain('<option value="16">');
  });

  it('locks the filter once a pick exists', () => {
    const html = render(detail({ picks: [{ pickNumber: 0, playerId: 'p1', teamKey: 'frc1' }] }));
    expect(html).toContain('Undo all picks to change the team pool.');
  });

  it('event rounds keep the 10 cap and no filter', () => {
    const html = render(detail({}, { kind: 'tba', seasonYear: null, eventKey: '2027paca' }));
    expect(html).not.toContain('Which teams');
    expect(html).toContain('<option value="10">10</option>');
    expect(html).not.toContain('<option value="11">');
  });
});
