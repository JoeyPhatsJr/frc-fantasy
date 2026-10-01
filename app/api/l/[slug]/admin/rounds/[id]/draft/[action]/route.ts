import { handle, HttpError, json, requireRound } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import type { DraftAction } from '@/lib/db/repo';
import { afterDraftChange } from '@/lib/draft/afterChange';
import { draftPhase } from '@/lib/draft/live';
import { loadDraftState } from '@/lib/draft/state';
import { loadPool } from '@/lib/rounds/pool';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string; action: string }> };

const ACTIONS: readonly DraftAction[] = ['start', 'pause', 'resume'];

/** Spec §7.3: POST …/admin/rounds/{id}/draft/start | pause | resume (commissioner only). */
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id, action } = await ctx.params;
    const { league, player } = await requireLeagueRole(slug, 'commissioner');
    const round = await requireRound(league, id);
    if (!ACTIONS.includes(action as DraftAction)) throw new HttpError(404, 'Not found');
    const repo = getRepo();
    const now = new Date();
    const picks = await repo.listPicks(round.id);
    const phase = draftPhase(round, picks.length);

    if (action === 'start') {
      if (round.finalizedAt) throw new HttpError(409, 'This round is finalized');
      if (round.draftMode !== 'live') throw new HttpError(409, 'Switch this round to live draft first');
      if (round.draftStartedAt) throw new HttpError(409, 'The draft has already started');
      const P = round.draftOrder.length;
      if (P === 0) throw new HttpError(409, 'Set the draft order before drafting');
      const pool = await loadPool(round, now);
      if (pool.stale && pool.tbaCount === 0) {
        throw new HttpError(503, "Couldn't reach The Blue Alliance for the team list. Try again in a minute.");
      }
      const T = pool.teams.length;
      if (P * round.rosterSize > T) {
        throw new HttpError(409, `With ${P} players and ${T} teams, roster size can be at most ${Math.floor(T / P)}`);
      }
    }
    if (action === 'pause' && phase !== 'live') throw new HttpError(409, "The draft isn't running");
    if (action === 'resume' && phase !== 'paused') throw new HttpError(409, "The draft isn't paused");

    if (!(await repo.draftControl(round.id, action as DraftAction))) {
      throw new HttpError(409, 'Draft changed in another tab — refresh');
    }
    await afterDraftChange(round.id, now, { advance: action !== 'pause' });
    const fresh = (await repo.getRound(round.id))!;
    return json(await loadDraftState(fresh, player, new Date()));
  });
}
