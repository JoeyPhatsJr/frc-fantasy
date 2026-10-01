import { handle, HttpError, json, requireRound } from '@/lib/api/http';
import { requireLeagueView } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { teamSheet } from '@/lib/stats/pool';
import { TEAM_KEY_RE } from '@/lib/teams';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string; id: string; teamKey: string }> };

/**
 * Spec §6.3 team sheet: per-event history for the round's season Y and Y−1, from team_stats only.
 * Same visibility as the pool: link leagues are open, members-only leagues are 403 to non-members.
 */
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id, teamKey } = await ctx.params;
    const { league } = await requireLeagueView(slug);
    const round = await requireRound(league, id);
    if (!TEAM_KEY_RE.test(teamKey)) throw new HttpError(404, 'Team not found');
    const season = Number(round.startDate.slice(0, 4));
    const rows = await getRepo().getTeamStats([teamKey], [season, season - 1], { withHistory: true });
    return json(teamSheet(teamKey, season, rows));
  });
}
