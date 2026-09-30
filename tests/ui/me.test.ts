import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/' }));

import { MeHome } from '@/components/me/MeHome';

const season = { total: 210, bestPick: { teamKey: 'frc341', eventName: 'Ramp Riot', points: 62 }, averageFinish: 1.5 };

describe('MeHome (spec §4.6)', () => {
  it('shows live teams, league rows, and season stats', () => {
    const out = render(
      h(MeHome, {
        page: {
          leagues: [
            { slug: 'fam', name: 'Habich Fam', isCommissioner: true, rank: 2, total: 184, anyLive: true, error: false },
            { slug: 'bad', name: 'Broken', isCommissioner: false, rank: null, total: 0, anyLive: false, error: true },
          ],
          teams: [{ teamKey: 'frc341', leagueName: 'Habich Fam', eventName: 'Ramp Riot', label: 'Q14 · up next', status: 'live' }],
          season,
        },
      }),
    );
    for (const text of ['Live now', '341', 'Q14 · up next', 'Habich Fam', '#2', '184', 'Couldn&#x27;t load', 'My season', '210', '341 at Ramp Riot · +62', '1.5']) {
      expect(out, text).toContain(text);
    }
  });
  it('empty state: create or join', () => {
    const out = render(h(MeHome, { page: { leagues: [], teams: [], season: { total: 0, bestPick: null, averageFinish: null } } }));
    expect(out).toContain('Create a league');
    expect(out).toContain('Have an invite code?');
    expect(out).not.toContain('Live now');
  });
});
