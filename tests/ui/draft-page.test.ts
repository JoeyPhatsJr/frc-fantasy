import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown, roundLoads: 0 }));
// Hand-entered rounds load the round page view, which asks TBA (here: an event with no data yet).
vi.mock('@/lib/tba/client', () => ({ getTba: async () => ({ data: null, fetchedAt: null, stale: false }) }));
vi.mock('@/lib/db', () => ({
  getRepo: () =>
    new Proxy(h.repo as object, {
      get(target, prop, receiver) {
        if (prop === 'getRound') h.roundLoads++;
        return Reflect.get(target, prop, receiver);
      },
    }),
}));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  usePathname: () => '/',
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

import DraftRoomPage from '@/app/l/[slug]/r/[roundId]/draft/page';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow, PlayerRow, RoundRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { seedLeague } from '../helpers/api';
import { makeUser, setUser, signInAsMember } from '../helpers/auth';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;
let commissioner: PlayerRow;
let round: RoundRow;

async function setup(visibility: 'link' | 'members') {
  repo = createMemoryRepo();
  h.repo = repo;
  ({ league, commissioner } = await seedLeague(repo, { visibility, signIn: false }));
  round = await repo.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot', startDate: '2025-10-25',
    endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
  });
  round = await repo.updateRound(round.id, { draftMode: 'live', pickSeconds: 60 });
  setUser(null);
  h.roundLoads = 0;
}

const render = async (slug: string, roundId: string) =>
  renderToStaticMarkup((await DraftRoomPage({ params: Promise.resolve({ slug, roundId }) })) as ReactElement);

describe('/l/{slug}/r/{roundId}/draft (spec §7.6)', () => {
  describe('members-only league', () => {
    beforeEach(() => setup('members'));

    it('shows signed-out visitors the private card with sign-in, and loads no round or draft data', async () => {
      const out = await render(league.slug, round.id);
      expect(out).toContain('Private league');
      expect(out).toContain('type="password"');
      for (const secret of ['Habich Fam', 'Ramp Riot', 'Loading the draft']) expect(out).not.toContain(secret);
      expect(h.roundLoads).toBe(0);
    });

    it('shows signed-in non-members the invite-code card instead of sign-in', async () => {
      setUser(await makeUser(repo, 'Stranger'));
      const out = await render(league.slug, round.id);
      expect(out).toContain('Private league — ask the commissioner for an invite code');
      expect(out).not.toContain('type="password"');
      expect(out).not.toContain('Ramp Riot');
      expect(h.roundLoads).toBe(0);
    });

    it('opens the draft room for members', async () => {
      await signInAsMember(repo, league, 'Mom');
      const out = await render(league.slug, round.id);
      expect(out).toContain('Ramp Riot draft');
      expect(out).toContain('Loading the draft');
      expect(h.roundLoads).toBe(1); // proves the counter the private-card tests rely on
    });
  });

  describe('link league', () => {
    beforeEach(() => setup('link'));

    it('lets signed-out visitors watch; the league tabs replace the old back link', async () => {
      const out = await render(league.slug, round.id);
      expect(out).toMatch(/<h1 class="sr-only">Ramp Riot draft<\/h1>/);
      expect(out).toContain('Loading the draft');
      expect(out).not.toContain(`href="/l/${league.slug}/r/${round.id}"`);
    });

    describe('hand-entered rounds show the draft board (UX §6.6)', () => {
      async function handEntered(picks: number) {
        const mom = await repo.createMember({ leagueId: league.id, userId: (await makeUser(repo, 'Mom')).id, name: 'Mom', role: 'player' });
        round = await repo.updateRound(round.id, {
          draftMode: 'commissioner', draftOrder: [commissioner.id, mom.id], rosterSize: 2,
        });
        const order = [commissioner.id, mom.id, mom.id, commissioner.id];
        const teams = ['frc341', 'frc254', 'frc25', 'frc5181'];
        for (let n = 0; n < picks; n++) {
          await repo.insertPick({ roundId: round.id, pickNumber: n, playerId: order[n]!, teamKey: teams[n]! });
        }
      }

      it('while picks are being entered: the commissioner strip, the count, and the board', async () => {
        await handEntered(1);
        const out = await render(league.slug, round.id);
        expect(out).toMatch(/<h1 class="sr-only">Ramp Riot draft<\/h1>/);
        expect(out).toContain('The commissioner enters picks for this event');
        expect(out).toContain('1 of 4 picks');
        expect(out).toContain('aria-label="Team 341"');
        expect(out).toContain('Commish');
        expect(out).toContain('Mom');
        for (const gone of ['No live draft for this round', 'See the draft board', 'Loading the draft']) {
          expect(out).not.toContain(gone);
        }
      });

      it('once every pick is in: "Draft complete"', async () => {
        await handEntered(4);
        const out = await render(league.slug, round.id);
        expect(out).toContain('Draft complete');
        expect(out).toContain('4 of 4 picks');
        expect(out).not.toContain('The commissioner enters picks for this event');
      });
    });

    it('404s an unknown league, a malformed round id, a missing round, and another league’s round', async () => {
      await expect(render('nope-zzz999', round.id)).rejects.toThrow('NEXT_NOT_FOUND');
      await expect(render(league.slug, 'not-a-uuid')).rejects.toThrow('NEXT_NOT_FOUND');
      await expect(render(league.slug, '00000000-0000-4000-8000-000000000000')).rejects.toThrow('NEXT_NOT_FOUND');
      const other = await repo.createLeague({
        slug: 'other-abc234', name: 'Other', defaultScoring: defaultScoring(), createdBy: 'x', visibility: 'link',
      });
      await expect(render(other.slug, round.id)).rejects.toThrow('NEXT_NOT_FOUND');
    });
  });
});
