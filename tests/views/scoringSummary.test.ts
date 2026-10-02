import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { scoringSummary } from '@/lib/views/scoringSummary';

/**
 * Adds 7 to the first numeric leaf (depth-first), so the test doesn't hard-code the config shape.
 * Skips `version`: it is the schema version, not a scoring rule, so the summary never shows it.
 */
function bumpFirstNumber(o: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(o)) {
    if (k === 'version') continue;
    if (typeof v === 'number' && v > 0) { o[k] = v + 7; return true; }
    if (Array.isArray(v) && typeof v[0] === 'number') { (v as number[])[0] += 7; return true; }
    if (v && typeof v === 'object' && bumpFirstNumber(v as Record<string, unknown>)) return true;
  }
  return false;
}

describe('scoringSummary', () => {
  it('describes the scoring rules in plain words', () => {
    const lines = scoringSummary(DEFAULT_SCORING);
    expect(lines.length).toBeGreaterThanOrEqual(6);
    for (const l of lines) {
      expect(l).toMatch(/\bpts?\b/);
      expect(l).not.toMatch(/\bRP\b/);
    }
  });
  it('reflects a changed value', () => {
    const before = scoringSummary(DEFAULT_SCORING).join('\n');
    const changed = structuredClone(DEFAULT_SCORING);
    expect(bumpFirstNumber(changed as unknown as Record<string, unknown>)).toBe(true);
    expect(scoringSummary(changed).join('\n')).not.toBe(before);
  });
});
