import { describe, expect, it } from 'vitest';
import { parseEventInput } from '@/lib/admin/eventInput';

describe('parseEventInput', () => {
  it('accepts a bare code in any case with spaces', () => {
    expect(parseEventInput('2025parr')).toBe('2025parr');
    expect(parseEventInput('  2025PARR ')).toBe('2025parr');
  });
  it('pulls the code out of a TBA link', () => {
    expect(parseEventInput('https://www.thebluealliance.com/event/2025parr')).toBe('2025parr');
    expect(parseEventInput('thebluealliance.com/event/2025parr#rankings')).toBe('2025parr');
    expect(parseEventInput('https://www.thebluealliance.com/event/2025parr/')).toBe('2025parr');
    expect(parseEventInput('https://www.thebluealliance.com/event/2025PARR?tab=teams')).toBe('2025parr');
  });
  it('leaves anything else trimmed and lowercased for the validator to reject', () => {
    expect(parseEventInput(' Not A Code ')).toBe('not a code');
    expect(parseEventInput('https://example.com/x')).toBe('https://example.com/x');
  });
});
