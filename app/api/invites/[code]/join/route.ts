import { handle, HttpError, json } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';
import { UniqueViolation } from '@/lib/db/repo';
import { MAX_PLAYERS } from '@/lib/leagues/membership';
import { uniqueName } from '@/lib/leagues/names';
import { leagueForCode } from '@/lib/leagues/invites';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ code: string }> };

/** Instant join (spec §2, §4.3): name = display name, suffixed " 2", " 3", … on a clash. */
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { code } = await ctx.params;
    const user = await requireUser();
    const league = await leagueForCode(code);
    const repo = getRepo();

    if (await repo.getMemberByUser(league.id, user.id)) return json({ slug: league.slug, alreadyMember: true });
    const base = (await repo.getProfile(user.id))?.displayName ?? 'Player';

    for (let attempt = 0; attempt < 3; attempt++) {
      const players = await repo.listPlayers(league.id);
      if (players.length >= MAX_PLAYERS) throw new HttpError(409, 'League is full');
      try {
        await repo.createMember({
          leagueId: league.id,
          userId: user.id,
          name: uniqueName(base, players.map((p) => p.name)),
          role: 'player',
        });
        return json({ slug: league.slug }, 201);
      } catch (err) {
        // Someone took the same name a moment ago: recompute the suffix and try again.
        if (err instanceof UniqueViolation && err.constraint === 'players_league_name_ci') continue;
        if (err instanceof UniqueViolation && err.constraint === 'players_league_user') {
          return json({ slug: league.slug, alreadyMember: true });
        }
        throw err;
      }
    }
    throw new HttpError(409, 'Could not pick a unique name. Try again.');
  });
}
