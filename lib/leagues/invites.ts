import { HttpError } from '@/lib/api/http';
import type { InvitePreview } from '@/lib/api/types';
import { getRepo } from '@/lib/db';
import type { LeagueRow } from '@/lib/db/types';
import { normalizeInviteCode } from '@/lib/leagues/inviteCode';
import { MAX_PLAYERS } from '@/lib/leagues/membership';

export const BAD_CODE_MESSAGE = "That invite code doesn't work — check with your commissioner.";

/** Uniform 404 for junk and unknown codes (spec §4.4, §4.8). */
export async function leagueForCode(raw: string): Promise<LeagueRow> {
  const code = normalizeInviteCode(raw);
  const league = code ? await getRepo().getLeagueByInviteCode(code) : null;
  if (!league) throw new HttpError(404, BAD_CODE_MESSAGE);
  return league;
}

/** What /join shows before joining (spec §4.6). Used by the API route and the /join page. */
export async function buildInvitePreview(league: LeagueRow, userId: string | null): Promise<InvitePreview> {
  const players = await getRepo().listPlayers(league.id);
  return {
    slug: league.slug,
    name: league.name,
    commissioner: players.find((p) => p.role === 'commissioner' && p.userId !== null)?.name ?? null,
    memberCount: players.filter((p) => p.userId !== null).length,
    full: players.length >= MAX_PLAYERS,
    alreadyMember: userId !== null && players.some((p) => p.userId === userId),
  };
}
