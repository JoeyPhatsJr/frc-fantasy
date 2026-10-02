import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
vi.mock('@/lib/tba/client', () => ({ getTba: async () => ({ data: null, fetchedAt: null, stale: false }) }));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  usePathname: () => '/',
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

import RoundPage from '@/app/l/[slug]/r/[roundId]/page';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { setUser } from '../helpers/auth';
import { seedLeague } from '../helpers/api';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;
let round: RoundRow;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  const seeded = await seedLeague(repo, { visibility: 'link' });
  league = seeded.league;
  round = await repo.createRound({
    leagueId: league.id, eventKey: '2026parr', eventName: 'Ramp Riot', startDate: '2026-10-24',
    endDate: '2026-10-24', timezone: 'America/New_York', scoring: defaultScoring(),
  });
  await repo.updateRound(round.id, { draftOrder: [seeded.commissioner.id] });
});

const page = async (roundId: string) =>
  renderToStaticMarkup((await RoundPage({ params: Promise.resolve({ slug: league.slug, roundId }) })) as ReactElement);

describe('Event tab (spec §6.5)', () => {
  it('/r/none shows the empty state; commissioners get the Admin link', async () => {
    const out = await page('none');
    expect(out).toContain('No events yet');
    expect(out).toContain('When the commissioner adds an event, it shows up here.');
    expect(out).toContain(`href="/l/${league.slug}/admin"`);
    expect(out).toContain('Add one in Admin');
    setUser(null);
    expect(await page('none')).not.toContain('Add one in Admin');
  });

  it('renders the strip, leaderboard and scoring link, and drops the old sections', async () => {
    const out = await page(round.id);
    expect(out).toContain('aria-label="Status"');
    expect(out).toContain('Draft not set up yet');
    expect(out).toContain('Leaderboard');
    expect(out).toContain('How scoring works');
    // The signed-in commissioner's own row: marked, highlighted and open, with a dash before the event.
    expect(out).toContain('Commish (you)');
    expect(out).toMatch(/<details[^>]*open=""/);
    expect(out).toContain('—');
    for (const gone of ['Rosters', 'Draft board', 'Standings']) expect(out).not.toContain(gone);
    // No adjustments in this round, so no Adjustments section.
    expect(out).not.toContain('Adjustments');
  });

  it('shows the Adjustments section only when there are any', async () => {
    await repo.insertAdjustment({ roundId: round.id, playerId: null, teamKey: 'frc5181', points: 5, reason: 'Spirit' });
    const out = await page(round.id);
    expect(out).toContain('Adjustments');
    expect(out).toContain('Spirit');
  });

  it('unknown rounds are a 404', async () => {
    await expect(page('00000000-0000-4000-8000-000000000000')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
