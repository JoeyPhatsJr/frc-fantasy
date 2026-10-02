import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PoolFootnote, PoolStatCells } from '@/components/pool/PoolStats';
import { PoolList } from '@/components/draft/PoolList';
import type { PoolEntry } from '@/lib/pool/entries';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const entry = (extra: Partial<PoolEntry> = {}): PoolEntry => ({
  teamKey: 'frc341', nickname: 'Miss Daisy', proj: 38.2, record: [12, 4, 0], bestFinish: 'winner',
  opr: 41.23, rank: 3, available: true, ...extra,
});
const listProps = (entries: PoolEntry[], over: Record<string, unknown> = {}) => ({
  slug: 'habich-fam-abc234',
  roundId: '00000000-0000-4000-8000-000000000001',
  entries,
  taken: new Set<string>(),
  queued: new Set<string>(),
  canDraft: false,
  draftLabel: 'Draft',
  readOnly: true,
  queueDisabled: false,
  onDraft: () => {},
  onToggleQueue: () => {},
  ...over,
});

describe('PoolStatCells', () => {
  it('shows Projected, W-L-T, the best-finish badge, and Robot rating (OPR) / rank', () => {
    const t = text(renderToStaticMarkup(h(PoolStatCells, { entry: entry() })));
    expect(t).toContain('Projected 38.2');
    expect(t).toContain('12-4-0');
    expect(t).toContain('Event winner');
    expect(t).toContain('Robot rating (OPR) 41.2 · #3');
  });

  it('shows a "New" chip instead of Projected, and no badge for a team never picked', () => {
    const html = renderToStaticMarkup(
      h(PoolStatCells, { entry: entry({ proj: null, bestFinish: null, record: null, opr: null, rank: null }) }),
    );
    expect(text(html)).toContain('New');
    expect(text(html).toLowerCase()).not.toContain('proj');
    expect(text(html)).not.toMatch(/winner|Finalist|Captain|Picked/);
  });

  it('gives an event winner the gold badge and other finishes the quiet one', () => {
    expect(renderToStaticMarkup(h(PoolStatCells, { entry: entry() }))).toContain('bg-accent');
    expect(renderToStaticMarkup(h(PoolStatCells, { entry: entry({ bestFinish: 'picked' }) }))).not.toContain('bg-accent');
  });
});

describe('PoolFootnote', () => {
  it('says projections use standard scoring (spec §6.3)', () => {
    expect(text(renderToStaticMarkup(h(PoolFootnote)))).toBe('Projected points use standard scoring.');
  });
});

describe("SP4's PoolList with real stats", () => {
  const rookie = entry({ teamKey: 'frc9999', nickname: 'Rookies', proj: null, record: null, bestFinish: null, opr: null, rank: null });

  it('renders the stat cells for a projected team and the New chip for a new one', () => {
    const t = text(renderToStaticMarkup(h(PoolList, listProps([entry(), rookie]))));
    expect(t).toContain('Projected 38.2');
    expect(t).toContain('12-4-0');
    expect(t).toContain('Event winner');
    expect(t).toContain('Robot rating (OPR) 41.2 · #3');
    expect(t).toContain('New');
    expect(t).toContain('Projected points use standard scoring.');
  });

  it('keeps nicknames readable at 360 px: the name wraps to two lines and the stats get their own line', () => {
    const html = renderToStaticMarkup(
      h(PoolList, listProps([entry({ nickname: 'The Cheesy Poofs of Robotics' })], { readOnly: false })),
    );
    // The name is clamped to two lines, not truncated to one.
    expect(html).toMatch(/<span[^>]*line-clamp-2[^>]*>The Cheesy Poofs of Robotics<\/span>/);
    // The stats line is a sibling of the name + buttons line, not squeezed into it.
    expect(html).toMatch(/data-pool-stats/);
    const [firstLine] = html.split('data-pool-stats');
    expect(firstLine).toContain('>Draft</button>');
  });
});
