import { HttpError } from '@/lib/api/http';
import type { Repo } from '@/lib/db/repo';
import { removeMember } from '@/lib/leagues/membership';

/**
 * Delete account (spec §4.2). Checks every league first so nothing changes when it's blocked:
 * blocked while I'm the only linked commissioner of a league with other linked members.
 * Then: leagues where I'm the only linked member are deleted; elsewhere my row is deleted or
 * unlinked (spec §4.3); finally the auth user is deleted (the profile cascades).
 */
export async function deleteAccount(repo: Repo, userId: string): Promise<void> {
  const memberships = await repo.listLeaguesForUser(userId);
  const plans: { leagueId: string; alone: boolean; player: (typeof memberships)[number]['player'] }[] = [];

  for (const { league, player } of memberships) {
    const players = await repo.listPlayers(league.id);
    const others = players.filter((p) => p.id !== player.id && p.userId !== null);
    const otherCommissioners = others.filter((p) => p.role === 'commissioner');
    if (others.length > 0 && player.role === 'commissioner' && otherCommissioners.length === 0) {
      throw new HttpError(409, `You're the only commissioner of ${league.name}. Make someone else commissioner first.`);
    }
    plans.push({ leagueId: league.id, alone: others.length === 0, player });
  }

  for (const plan of plans) {
    if (plan.alone) await repo.deleteLeague(plan.leagueId);
    else await removeMember(repo, plan.player);
  }
  await repo.deleteUser(userId);
}
