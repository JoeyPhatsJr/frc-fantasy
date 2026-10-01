import { z } from 'zod';
import { handle, HttpError, json, noContent, parseBody } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import type { AdminLeague } from '@/lib/api/types';
import { getRepo } from '@/lib/db';
import type { LeagueRow } from '@/lib/db/types';
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
    visibility: z.enum(['link', 'members'], 'visibility must be link or members').optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change' });

function toAdminLeague(l: LeagueRow): AdminLeague {
  return {
    slug: l.slug,
    name: l.name,
    homeTeamNumber: l.homeTeamNumber,
    defaultScoring: l.defaultScoring,
    inviteCode: l.inviteCode,
    visibility: l.visibility,
    format: l.format,
  };
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const patch = await parseBody(req, patchSchema);
    const saved = await getRepo().updateLeague(league.id, patch);
    return json({ league: toAdminLeague(saved) });
  });
}

const deleteSchema = z.object({ confirmName: z.string('Type the league name to delete it').max(200) });

/** Delete league (spec §4.4): the commissioner types the league name exactly. Cascades like v1. */
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const { confirmName } = await parseBody(req, deleteSchema);
    if (confirmName.trim() !== league.name) throw new HttpError(400, 'Type the league name exactly to delete it');
    await getRepo().deleteLeague(league.id);
    return noContent();
  });
}
