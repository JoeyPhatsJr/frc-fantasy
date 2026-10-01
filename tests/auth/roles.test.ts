import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ repo: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/auth/session', async () => (await import('../helpers/auth')).fakeSession);

import { leagueAccess, requireLeagueRole, requireLeagueView } from '@/lib/auth/roles';
import type { Repo } from '@/lib/db/repo';
import type { LeagueRow } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { makeUser, setUser, signInAsMember } from '../helpers/auth';
import { createMemoryRepo } from '../helpers/memoryRepo';

let repo: Repo;
let league: LeagueRow;

beforeEach(async () => {
  repo = createMemoryRepo();
  h.repo = repo;
  setUser(null);
  league = await repo.createLeague({ slug: 'fam-abc234', name: 'Fam', defaultScoring: defaultScoring() });
});

describe('requireLeagueRole', () => {
  it('answers 401 signed out, before looking at the league', async () => {
    await expect(requireLeagueRole('no-such-league', 'player')).rejects.toMatchObject({ status: 401 });
  });
  it('answers 404 for an unknown league', async () => {
    setUser(await makeUser(repo));
    await expect(requireLeagueRole('no-such-league', 'player')).rejects.toMatchObject({
      status: 404, message: 'League not found',
    });
  });
  it('answers 403 for a non-member and for a player asking for commissioner', async () => {
    setUser(await makeUser(repo, 'Stranger'));
    await expect(requireLeagueRole(league.slug, 'player')).rejects.toMatchObject({ status: 403, message: 'Forbidden' });
    await signInAsMember(repo, league, 'Mom', 'player');
    await expect(requireLeagueRole(league.slug, 'commissioner')).rejects.toMatchObject({ status: 403 });
  });
  it('admits members, and commissioners for player-level checks', async () => {
    const { player } = await signInAsMember(repo, league, 'Joey', 'commissioner');
    expect((await requireLeagueRole(league.slug, 'commissioner')).player.id).toBe(player.id);
    expect((await requireLeagueRole(league.slug, 'player')).league.id).toBe(league.id);
  });
  it("doesn't let league A's commissioner into league B", async () => {
    await signInAsMember(repo, league, 'Joey', 'commissioner');
    await repo.createLeague({ slug: 'other-bbbbbb', name: 'Other', defaultScoring: defaultScoring() });
    await expect(requireLeagueRole('other-bbbbbb', 'commissioner')).rejects.toMatchObject({ status: 403 });
  });
});

describe('leagueAccess / requireLeagueView (spec §4.5)', () => {
  it('lets anyone view a link league, signed in or not', async () => {
    const a = await leagueAccess(league.slug);
    expect(a).toMatchObject({ canView: true, isCommissioner: false, user: null, player: null });
    await expect(requireLeagueView(league.slug)).resolves.toMatchObject({ player: null });
  });
  it('hides a members-only league from non-members with a uniform 403', async () => {
    await repo.updateLeague(league.id, { visibility: 'members' });
    expect((await leagueAccess(league.slug))!.canView).toBe(false);
    await expect(requireLeagueView(league.slug)).rejects.toMatchObject({ status: 403, message: 'This league is private' });
    setUser(await makeUser(repo, 'Stranger'));
    await expect(requireLeagueView(league.slug)).rejects.toMatchObject({ status: 403 });
  });
  it('shows a members-only league to its members and flags commissioners', async () => {
    await repo.updateLeague(league.id, { visibility: 'members' });
    await signInAsMember(repo, league, 'Joey', 'commissioner');
    expect(await leagueAccess(league.slug)).toMatchObject({ canView: true, isCommissioner: true });
  });
  it('is null / 404 for an unknown league', async () => {
    expect(await leagueAccess('nope-abc234')).toBeNull();
    await expect(requireLeagueView('nope-abc234')).rejects.toMatchObject({ status: 404 });
  });
});
