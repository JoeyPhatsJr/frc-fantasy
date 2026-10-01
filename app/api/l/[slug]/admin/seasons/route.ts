import { handle, HttpError, json } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { createSeasonRound } from '@/lib/leagues/formatSetup';
import { nextPoolFilter } from '@/lib/season/next';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string }> };

/** "Start {year + 1} season" (spec §5.5): copies the draft order (linked players), roster size and pool. */
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    if (league.format !== 'season') throw new HttpError(409, 'Only full-season leagues have seasons');
    const repo = getRepo();
    const [rounds, players] = await Promise.all([repo.listRounds(league.id), repo.listPlayers(league.id)]);
    const seasons = rounds.filter((r) => r.kind === 'season' && r.seasonYear !== null);
    if (seasons.length === 0) throw new HttpError(409, 'This league has no season yet');
    const latest = seasons.reduce((a, b) => (b.seasonYear! > a.seasonYear! ? b : a));
    if (!latest.finalizedAt) throw new HttpError(409, `Mark the ${latest.seasonYear} season final first`);

    const year = latest.seasonYear! + 1;
    const linked = new Set(players.filter((p) => p.userId !== null).map((p) => p.id));
    const round = await createSeasonRound(league, {
      year,
      poolFilter: nextPoolFilter(latest.poolFilter, year),
      rosterSize: latest.rosterSize,
      draftOrder: latest.draftOrder.filter((id) => linked.has(id)),
    });
    return json({ round: { id: round.id, eventName: round.eventName, seasonYear: round.seasonYear } }, 201);
  });
}
