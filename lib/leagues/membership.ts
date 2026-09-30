import { HttpError } from '@/lib/api/http';
import type { Repo } from '@/lib/db/repo';
import type { PlayerRow } from '@/lib/db/types';
import { playersInUse } from '@/lib/rounds/usage';

export const MAX_PLAYERS = 30; // per league, counting unlinked rows (spec §4.3)
export const MAX_LEAGUES_PER_USER = 5; // created by one user (spec §4.4)

export const LAST_COMMISSIONER_MESSAGE =
  'A league needs at least one commissioner. Make someone else commissioner first.';

/** Throws 409 if `target` is the league's only commissioner who still has an account. */
export function assertKeepsCommissioner(players: PlayerRow[], target: PlayerRow): void {
  if (target.role !== 'commissioner' || target.userId === null) return;
  const others = players.filter((p) => p.id !== target.id && p.role === 'commissioner' && p.userId !== null);
  if (others.length === 0) throw new HttpError(409, LAST_COMMISSIONER_MESSAGE);
}

/**
 * Remove member / leave / account deletion (spec §4.3): a row with no picks, adjustments or
 * draft-order entries is deleted; otherwise it is unlinked so history and standings stay intact.
 */
export async function removeMember(repo: Repo, player: PlayerRow): Promise<'deleted' | 'unlinked'> {
  const used = await playersInUse(repo, player.leagueId);
  if (used.has(player.id)) {
    await repo.updatePlayer(player.id, { userId: null, role: 'player' });
    return 'unlinked';
  }
  await repo.deletePlayer(player.id);
  return 'deleted';
}
