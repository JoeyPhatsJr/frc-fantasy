import { HttpError } from '@/lib/api/http';
import { getUser, requireUser, type SessionUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';
import type { LeagueRole, LeagueRow, PlayerRow } from '@/lib/db/types';

export type { LeagueRole } from '@/lib/db/types';

/**
 * The membership check for every mutating league route (spec §4.5).
 * 401 signed out → 404 unknown league → 403 not a member / not a commissioner.
 * 'player' also admits commissioners.
 */
export async function requireLeagueRole(
  slug: string,
  role: LeagueRole,
): Promise<{ user: SessionUser; league: LeagueRow; player: PlayerRow }> {
  const user = await requireUser();
  const repo = getRepo();
  const league = await repo.getLeagueBySlug(slug);
  if (!league) throw new HttpError(404, 'League not found');
  const player = await repo.getMemberByUser(league.id, user.id);
  if (!player || (role === 'commissioner' && player.role !== 'commissioner')) {
    throw new HttpError(403, 'Forbidden');
  }
  return { user, league, player };
}

export type LeagueAccess = {
  user: SessionUser | null;
  league: LeagueRow;
  player: PlayerRow | null;
  /** link leagues: everyone. members leagues: members only. */
  canView: boolean;
  isCommissioner: boolean;
};

/** For pages: who is looking and what they may see. null = no such league. */
export async function leagueAccess(slug: string): Promise<LeagueAccess | null> {
  const repo = getRepo();
  const [user, league] = await Promise.all([getUser(), repo.getLeagueBySlug(slug)]);
  if (!league) return null;
  const player = user ? await repo.getMemberByUser(league.id, user.id) : null;
  return {
    user,
    league,
    player,
    canView: league.visibility === 'link' || player !== null,
    isCommissioner: player?.role === 'commissioner',
  };
}

/** For read APIs (pool, draft state): 404 unknown, 403 for non-members of members-only leagues. */
export async function requireLeagueView(
  slug: string,
): Promise<{ user: SessionUser | null; league: LeagueRow; player: PlayerRow | null }> {
  const access = await leagueAccess(slug);
  if (!access) throw new HttpError(404, 'League not found');
  if (!access.canView) throw new HttpError(403, 'This league is private');
  return { user: access.user, league: access.league, player: access.player };
}
