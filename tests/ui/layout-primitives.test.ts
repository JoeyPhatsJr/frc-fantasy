import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Row, RankNumeral, Points } from '@/components/ui/Row';
import { Section } from '@/components/ui/Section';
import { StatusStrip } from '@/components/ui/StatusStrip';
import { BandTabs } from '@/components/ui/Tabs';
import { lockBodyScroll, Sheet } from '@/components/ui/Sheet';
import { PageTabs } from '@/components/ui/PageTabs';

const r = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('Row', () => {
  it('is a plain row with hairline divider and truncating title', () => {
    const html = r(h(Row, { title: 'Indiana State Championship presented by Toyota', trailing: '212' }));
    expect(html).toContain('border-b border-border');
    expect(html).toContain('min-w-0');
    expect(html).toContain('truncate');
    expect(html).toContain('min-h-11');
  });
  it('is a link when given href', () => {
    expect(r(h(Row, { title: 'Family', href: '/l/fam' }))).toMatch(/<a [^>]*href="\/l\/fam"/);
  });
  it('highlights your row with the blue inset bar', () => {
    const html = r(h(Row, { title: 'Joey', highlight: true }));
    expect(html).toContain('bg-surface');
    expect(html).toContain('shadow-[inset_4px_0_0_var(--color-primary-fill)]');
  });
  it('expands with details/summary, open when defaultOpen', () => {
    const closed = r(h(Row, { title: 'Mom', expanded: h('p', null, 'teams') }));
    expect(closed).toMatch(/^<details/);
    expect(closed).toContain('<summary');
    expect(closed).not.toContain(' open=""');
    expect(r(h(Row, { title: 'Joey', expanded: 'x', defaultOpen: true }))).toContain(' open=""');
  });
});

describe('RankNumeral / Points', () => {
  it('colors the podium', () => {
    expect(r(h(RankNumeral, { rank: 1 }))).toContain('text-accent-text');
    expect(r(h(RankNumeral, { rank: 2 }))).toContain('text-silver');
    expect(r(h(RankNumeral, { rank: 3 }))).toContain('text-bronze');
    expect(r(h(RankNumeral, { rank: 4 }))).toContain('text-fg-muted');
  });
  it('shows a dash for no score', () => {
    expect(r(h(Points, { value: null }))).toContain('—');
    expect(r(h(Points, { value: 212 }))).toContain('tabular-nums');
  });
});

describe('Section', () => {
  it('renders an uppercase label heading', () => {
    const html = r(h(Section, { label: 'Your leagues', children: 'rows' }));
    expect(html).toContain('<h2');
    expect(html).toContain('uppercase');
    expect(html).toContain('Your leagues');
  });
});

describe('StatusStrip', () => {
  it('shows LIVE with a pulsing dot for live', () => {
    const html = r(h(StatusStrip, { tone: 'live', title: 'Ramp Riot', detail: 'updated 1 min ago' }));
    expect(html).toContain('LIVE');
    expect(html).toContain('motion-safe:animate-pulse');
  });
  it('is a labelled region; only the detail line is a polite live region (final review M3)', () => {
    const html = r(h(StatusStrip, {
      tone: 'live', title: 'Ramp Riot', detail: 'Last updated 1 min ago',
      action: h('a', { href: '/x' }, 'Open draft room'),
    }));
    expect(html).toMatch(/^<section aria-label="Status"/);
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('<p role="status" aria-live="polite" class="text-[13px] text-fg-muted">Last updated 1 min ago</p>');
    // The live region holds only the detail text, never the action.
    expect(html).not.toMatch(/role="status"[^>]*>[^<]*<a/);
    expect(r(h(StatusStrip, { tone: 'neutral', title: 'No events yet' }))).not.toContain('role="status"');
  });
  it('wraps long titles instead of overflowing', () => {
    expect(r(h(StatusStrip, { tone: 'neutral', title: 'x' }))).toContain('break-words');
  });
});

describe('BandTabs', () => {
  it('marks the active tab with aria-current and the gold underline', () => {
    const html = r(h(BandTabs, { label: 'League', active: 'event', items: [
      { key: 'standings', label: 'Standings', href: '/l/f' },
      { key: 'event', label: 'Event', href: '/l/f/r/1' },
    ] }));
    expect(html).toContain('aria-label="League"');
    expect(html).toMatch(/<a [^>]*aria-current="page"[^>]*href="\/l\/f\/r\/1"/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('border-accent');
    expect(html).toContain('min-h-11');
  });
});

describe('Sheet', () => {
  it('renders nothing when closed and a modal dialog when open', () => {
    expect(r(h(Sheet, { open: false, onClose: () => {}, title: 'Leagues', children: 'x' }))).toBe('');
    const html = r(h(Sheet, { open: true, onClose: () => {}, title: 'Leagues', children: 'x' }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Close"');
  });
  it('locks page scroll while open and restores the previous value (final review M13)', () => {
    const body = { style: { overflow: 'auto' } };
    const unlock = lockBodyScroll(body);
    expect(body.style.overflow).toBe('hidden');
    unlock();
    expect(body.style.overflow).toBe('auto');
    const plain = { style: { overflow: '' } };
    lockBodyScroll(plain)();
    expect(plain.style.overflow).toBe('');
  });
});

describe('PageTabs', () => {
  it('renders a tablist with exactly one selected tab', () => {
    const html = r(h(PageTabs, { label: 'Views', active: 'b', onSelect: () => {}, items: [
      { key: 'a', label: 'A' }, { key: 'b', label: 'B' },
    ] }));
    expect(html).toContain('role="tablist"');
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
  });
  it('gives every tab an id, even without a prefix', () => {
    const html = r(h(PageTabs, { label: 'Views', active: 'a', onSelect: () => {}, items: [
      { key: 'a', label: 'A' }, { key: 'b', label: 'B' },
    ] }));
    expect(html.match(/role="tab" id="[^"]+-tab-[ab]"/g)).toHaveLength(2);
    expect(html).not.toContain('aria-controls');
  });
});
