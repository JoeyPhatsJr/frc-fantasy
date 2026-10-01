import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PoolList } from '@/components/draft/PoolList';
import { TeamSheetBody } from '@/components/pool/TeamSheet';
import type { PoolEntry } from '@/lib/pool/entries';
import type { TeamSheetData } from '@/lib/stats/pool';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ').trim();

const data: TeamSheetData = {
  teamKey: 'frc341',
  season: 2026,
  proj: 38.2,
  seasons: [
    {
      season: 2026, eventsPlayed: 2, totalPoints: 72, record: [8, 2, 0], bestFinish: 'winner',
      events: [
        { eventKey: '2026paca', name: 'Greater Pittsburgh', endDate: '2026-03-08', rank: 1, finish: 'winner', points: 50 },
        { eventKey: '2026mrcmp', name: 'FMA District Championship', endDate: '2026-04-05', rank: null, finish: null, points: 22 },
      ],
      awards: [{ type: 0, name: 'FIRST Impact Award', eventKey: '2026paca' }],
    },
    { season: 2025, eventsPlayed: 2, totalPoints: 30, record: [10, 10, 0], bestFinish: null, events: [], awards: [] },
  ],
};

describe('TeamSheetBody', () => {
  it('shows the team, the projection, and each season newest first', () => {
    const t = text(renderToStaticMarkup(h(TeamSheetBody, { data, nickname: 'Miss Daisy' })));
    expect(t).toContain('Miss Daisy');
    expect(t).toContain('38.2');
    expect(t.indexOf('2026')).toBeLessThan(t.indexOf('2025'));
    expect(t).toContain('8-2-0');
  });

  it('lists each event with rank, finish, and fantasy points, plus awards', () => {
    const t = text(renderToStaticMarkup(h(TeamSheetBody, { data, nickname: null })));
    expect(t).toContain('Greater Pittsburgh');
    expect(t).toContain('#1');
    expect(t).toContain('Event winner');
    expect(t).toContain('+50');
    expect(t).toContain('FIRST Impact Award');
    expect(t).toContain('No rank');
  });

  it('puts each award under the event it was won at', () => {
    const t = text(renderToStaticMarkup(h(TeamSheetBody, { data, nickname: null })));
    const award = t.indexOf('FIRST Impact Award');
    expect(award).toBeGreaterThan(t.indexOf('Greater Pittsburgh'));
    expect(award).toBeLessThan(t.indexOf('FMA District Championship'));
  });

  it('says so plainly for a New team', () => {
    const t = text(
      renderToStaticMarkup(
        h(TeamSheetBody, { data: { teamKey: 'frc9999', season: 2026, proj: null, seasons: [] }, nickname: null }),
      ),
    );
    expect(t).toContain('New');
    expect(t).toContain('No results in 2025 or 2026');
  });

  it('includes the standard-scoring footnote', () => {
    expect(text(renderToStaticMarkup(h(TeamSheetBody, { data, nickname: null })))).toContain('Proj. uses standard scoring');
  });
});

describe('PoolList rows open the team sheet', () => {
  const entry: PoolEntry = {
    teamKey: 'frc341', nickname: 'Miss Daisy', proj: 38.2, record: [12, 4, 0], bestFinish: 'winner',
    opr: 41.2, rank: 3, available: true,
  };
  const props = {
    slug: 'habich-fam-abc234', roundId: '00000000-0000-4000-8000-000000000001', entries: [entry],
    taken: new Set<string>(), queued: new Set<string>(), canDraft: true, draftLabel: 'Draft', readOnly: false,
    queueDisabled: false, onDraft: () => {}, onToggleQueue: () => {},
  };

  it('makes the team area a 44 px button that opens a dialog, beside the separate queue and Draft buttons', () => {
    const html = renderToStaticMarkup(h(PoolList, props));
    const open = html.match(/<button[^>]*aria-haspopup="dialog"[^>]*>/g) ?? [];
    expect(open).toHaveLength(1);
    expect(open[0]).toContain('min-h-11');
    expect(open[0]).toContain('aria-label="Team 341 Miss Daisy, show history"');
    expect(html).toContain('aria-label="Add 341 to queue"');
    expect(html).toMatch(/<button[^>]*>Draft<\/button>/);
  });

  it('still opens the sheet for read-only watchers', () => {
    const html = renderToStaticMarkup(h(PoolList, { ...props, readOnly: true }));
    expect(html).toMatch(/aria-haspopup="dialog"/);
  });
});
