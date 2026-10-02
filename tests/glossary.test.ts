import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GLOSSARY, type GlossaryKey } from '@/lib/glossary';
import { InfoTip } from '@/components/ui/InfoTip';

const KEYS: GlossaryKey[] = ['opr', 'proj', 'rp', 'quals', 'playoffs', 'alliance', 'queue', 'autodraft', 'snake', 'pool', 'adjust', 'eventcode', 'commish'];

describe('GLOSSARY', () => {
  it('has a label and a one-sentence explainer for every term', () => {
    expect(Object.keys(GLOSSARY).sort()).toEqual([...KEYS].sort());
    for (const k of KEYS) {
      expect(GLOSSARY[k].label.length, k).toBeGreaterThan(1);
      expect(GLOSSARY[k].short, k).toMatch(/^[A-Z].*\.$/);
      expect(GLOSSARY[k].short.length, k).toBeLessThanOrEqual(140);
    }
  });
  it('spells out jargon', () => {
    expect(GLOSSARY.opr.label).toBe('Robot rating (OPR)');
    expect(GLOSSARY.rp.label).toBe('Ranking points');
    expect(GLOSSARY.proj.label).toBe('Projected');
  });
});

describe('InfoTip', () => {
  it('is a 44px button labelled with the term, closed by default', () => {
    const html = renderToStaticMarkup(h(InfoTip, { term: 'opr' }));
    expect(html).toMatch(/^<span/);
    expect(html).toContain('aria-label="What is Robot rating (OPR)?"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('size-11');
    expect(html).not.toContain(GLOSSARY.opr.short);
  });
});
