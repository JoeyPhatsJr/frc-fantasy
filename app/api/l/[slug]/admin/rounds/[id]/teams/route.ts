import { z } from 'zod';
import {
  handle,
  HttpError,
  json,
  parseBody,
  requireCommissioner,
  requireRound,
} from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import { parseTeamInput } from '@/lib/teams';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string; id: string }> };

const BAD_TEAM = 'Team numbers look like 341 or 341B';

const bodySchema = z.object({
  teamNumber: z.union([z.string(BAD_TEAM).max(20, BAD_TEAM), z.number(BAD_TEAM)], BAD_TEAM),
});

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const round = await requireRound(league, id);
    const { teamNumber } = await parseBody(req, bodySchema);
    const teamKey = parseTeamInput(String(teamNumber));
    if (!teamKey) throw new HttpError(400, BAD_TEAM);
    await getRepo().addExtraTeam(round.id, teamKey);
    return json({ teamKey }, 201);
  });
}
