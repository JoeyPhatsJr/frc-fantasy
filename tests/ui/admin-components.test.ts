import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminGate } from '@/components/admin/AdminGate';
import { ScoringForm } from '@/components/admin/ScoringForm';
import { DEFAULT_SCORING } from '@/lib/scoring/config';

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('AdminGate', () => {
  it('shows the checking state before the token has been verified', () => {
    // Effects don't run on the server, so this is exactly what the browser shows first.
    const html = render(h(AdminGate, { slug: 'abc', children: () => h('p', null, 'secret dashboard') }));
    expect(html).toContain('Checking your admin link…');
    expect(html).toContain('id="main"');
    expect(html).not.toContain('secret dashboard');
  });
});

describe('ScoringForm', () => {
  const html = render(
    h(ScoringForm, { initial: DEFAULT_SCORING, saveLabel: 'Save default scoring', onSave: async () => {} }),
  );

  it('shows every group and both action buttons', () => {
    for (const title of [
      'Qualification matches',
      'Qualification rank',
      'Alliance selection',
      'Playoffs',
      'Awards',
      'OPR bonus (after quals)',
    ]) {
      expect(html).toContain(`>${title}</legend>`);
    }
    expect(html).toContain('Save default scoring');
    expect(html).toContain('Reset to defaults');
  });

  it('renders every field as a labelled number box', () => {
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    // 4 qual + 3 tiers × 2 + 5 alliance + 3 playoffs + 4 awards + 3 OPR places
    expect(inputs).toHaveLength(25);
    for (const input of inputs) {
      expect(input).toContain('type="number"');
      const id = input.match(/ id="([^"]+)"/)?.[1];
      const labelled = input.includes('aria-label="') || (id !== undefined && html.includes(`for="${id}"`));
      expect(labelled, input).toBe(true);
    }
  });

  it('starts from the given values', () => {
    expect(html).toContain('value="3"'); // qualWin
    expect(html).toContain('value="15"'); // eventWinner
  });
});
