import { z } from 'zod';
import {
  handle,
  HttpError,
  json,
  parseBody,
  requireRound,
} from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { loadPool } from '@/lib/rounds/pool';
import { pickerFor } from '@/lib/scoring/round';
import { TEAM_KEY_RE } from '@/lib/teams';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string }> };

const bodySchema = z.object({
  expectedPickNumber: z
    .number('expectedPickNumber must be a whole number, 0 or more')
    .int('expectedPickNumber must be a whole number, 0 or more')
    .min(0, 'expectedPickNumber must be a whole number, 0 or more'),
  teamKey: z.string('teamKey is required').regex(TEAM_KEY_RE, 'Team keys look like frc341'),
});

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const round = await requireRound(league, id);
    const { expectedPickNumber, teamKey } = await parseBody(req, bodySchema);
    const repo = getRepo();

    if (round.draftOrder.length === 0) {
      throw new HttpError(409, 'Set the draft order before drafting');
    }
    const picks = await repo.listPicks(round.id);
    if (expectedPickNumber !== picks.length) {
      throw new HttpError(409, 'Draft changed in another tab — refresh');
    }
    if (picks.length >= round.draftOrder.length * round.rosterSize) {
      throw new HttpError(409, 'The draft is full');
    }
    const pool = await loadPool(round, new Date());
    if (!pool.teams.some((t) => t.teamKey === teamKey)) {
      throw new HttpError(400, "That team isn't in this event's team pool");
    }

    // The database's unique constraints are the real guard against two tabs picking at once.
    // If one fires, handle() turns it into the matching 409.
    const saved = await repo.insertPick({
      roundId: round.id,
      pickNumber: expectedPickNumber,
      playerId: pickerFor(expectedPickNumber, round.draftOrder),
      teamKey,
    });
    return json(
      { pick: { pickNumber: saved.pickNumber, playerId: saved.playerId, teamKey: saved.teamKey } },
      201,
    );
  });
}
