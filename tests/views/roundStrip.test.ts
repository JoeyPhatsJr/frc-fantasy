import { describe, expect, it } from 'vitest';
import { freshnessText } from '@/lib/format';
import { roundStrip, type StripInput } from '@/lib/views/roundStrip';

const NOW = new Date('2026-10-24T15:00:00Z');
const base: StripInput = {
  slug: 'fam', roundId: 'r1', eventName: 'Ramp Riot', startDate: '2026-10-24', endDate: '2026-10-24',
  status: 'live', kind: 'tba', fetchedAt: '2026-10-24T14:59:00Z', stale: false, winnerName: null,
};

describe('roundStrip', () => {
  it('setup', () => {
    expect(roundStrip({ ...base, status: 'setup' }, NOW)).toMatchObject({ tone: 'neutral', title: 'Draft not set up yet', action: null });
  });
  it('drafting points at the draft room', () => {
    expect(roundStrip({ ...base, status: 'drafting' }, NOW)).toMatchObject({
      tone: 'drafting', title: 'Draft in progress', action: { label: 'Open draft room', href: '/l/fam/r/r1/draft' },
    });
  });
  it('upcoming names the start date', () => {
    expect(roundStrip({ ...base, status: 'upcoming' }, NOW).title).toBe('Starts Oct 24');
  });
  it('live shows freshness from TBA', () => {
    const s = roundStrip(base, NOW);
    expect(s.tone).toBe('live');
    expect(s.title).toBe('Live now');
    expect(s.detail).toBe(freshnessText('2026-10-24T14:59:00Z', false, NOW));
  });
  it('manual rounds say who enters scores instead of TBA freshness', () => {
    expect(roundStrip({ ...base, kind: 'manual' }, NOW).detail).toBe('Scores entered by the commissioner');
  });
  it('awaiting final warns results may change', () => {
    expect(roundStrip({ ...base, status: 'awaiting_final' }, NOW)).toMatchObject({ tone: 'final', title: 'Event over · results may still change' });
  });
  it('final names the winner', () => {
    expect(roundStrip({ ...base, status: 'final', winnerName: 'Mom' }, NOW).title).toBe('Final · Mom wins');
    expect(roundStrip({ ...base, status: 'final' }, NOW).title).toBe('Final');
  });
  it('encodes the slug in links', () => {
    expect(roundStrip({ ...base, slug: 'a b', status: 'drafting' }, NOW).action?.href).toBe('/l/a%20b/r/r1/draft');
  });
});
