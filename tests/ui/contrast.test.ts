import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');

/** Token values inside the first block that starts with `opener`. */
function tokens(opener: RegExp): Record<string, string> {
  const start = css.search(opener);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const dark = tokens(/@theme\s*\{/);
const light = { ...dark, ...tokens(/:root\[data-theme="light"\]\s*\{/) };

const PAIRS: [string, string][] = [
  ['fg', 'bg'], ['fg', 'surface'], ['fg-muted', 'bg'], ['fg-muted', 'surface'],
  ['primary', 'bg'], ['primary', 'surface'], ['on-primary', 'primary-fill'],
  ['on-band', 'band'], ['band-muted', 'band'], ['accent-text', 'bg'], ['on-accent', 'accent'],
  ['red-alliance-text', 'bg'], ['on-success', 'success'],
  ['warning', 'surface-2'], // the Awaiting final badge (final review M9)
];

describe.each([['dark', dark], ['light', light]] as const)('%s theme tokens', (_name, t) => {
  it('defines the broadcast band tokens', () => {
    for (const k of ['band', 'on-band', 'band-muted']) expect(t[k], k).toMatch(/^#[0-9a-f]{6}$/);
  });
  it.each(PAIRS)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(t[fg], fg).toBeDefined();
    expect(t[bg], bg).toBeDefined();
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
  it('no longer uses the stock Tailwind light palette', () => {
    expect(Object.values(t)).not.toContain('#eff6ff');
    expect(Object.values(t)).not.toContain('#2563eb');
  });
  // WCAG 1.4.11: a field's edge must be at least 3:1 against the field and the page around it.
  it.each([['surface'], ['bg'], ['surface-2']])('field-border on %s is at least 3:1', (bg) => {
    expect(t['field-border'], 'field-border').toBeDefined();
    expect(contrast(t['field-border'], t[bg])).toBeGreaterThanOrEqual(3);
  });
  it('the live dot on the band is at least 3:1', () => {
    expect(contrast(t['band-live'], t.band)).toBeGreaterThanOrEqual(3);
  });
  it('podium colors are at least 3:1 on the page', () => {
    expect(contrast(t.silver, t.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(t.bronze, t.bg)).toBeGreaterThanOrEqual(3);
  });
});
