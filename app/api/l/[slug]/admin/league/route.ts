import { z } from 'zod';
import { handle, json, parseBody, requireCommissioner } from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import { scoringConfigSchema } from '@/lib/scoring/config';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

const patchSchema = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1, 'League name is required')
      .max(80, 'League name must be 80 characters or fewer')
      .optional(),
    homeTeamNumber: z
      .number()
      .int()
      .min(1, 'Home team number must be between 1 and 99999')
      .max(99999, 'Home team number must be between 1 and 99999')
      .optional(),
    defaultScoring: scoringConfigSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change' });

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const league = await requireCommissioner(req, slug);
    const patch = await parseBody(req, patchSchema);
    const saved = await getRepo().updateLeague(league.id, patch);
    return json({
      league: {
        slug: saved.slug,
        name: saved.name,
        homeTeamNumber: saved.homeTeamNumber,
        defaultScoring: saved.defaultScoring,
      },
    });
  });
}
