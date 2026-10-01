import { z } from 'zod';
import { handle, HttpError, json, parseBody } from '@/lib/api/http';
import { makeSlug } from '@/lib/auth/commissioner';
import { requireUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';
import { UniqueViolation } from '@/lib/db/repo';
import { MAX_LEAGUES_PER_USER } from '@/lib/leagues/membership';
import { defaultScoring } from '@/lib/scoring/config';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  name: z
    .string('League name is required')
    .trim()
    .min(1, 'League name is required')
    .max(80, 'League name must be 80 characters or fewer'),
  visibility: z.enum(['link', 'members'], 'visibility must be link or members').optional(),
});

/** Create a league (spec §4.4). The creator becomes its first commissioner. */
export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const body = await parseBody(req, bodySchema);
    const repo = getRepo();

    if ((await repo.countLeaguesCreatedBy(user.id)) >= MAX_LEAGUES_PER_USER) {
      throw new HttpError(409, `You've reached the ${MAX_LEAGUES_PER_USER}-league limit`);
    }
    const profile = await repo.getProfile(user.id);
    const myName = profile?.displayName ?? 'Player';

    for (let attempt = 0; attempt < 5; attempt++) {
      let league;
      try {
        league = await repo.createLeague({
          slug: makeSlug(body.name),
          name: body.name,
          defaultScoring: defaultScoring(),
          createdBy: user.id,
          visibility: body.visibility ?? 'link',
        });
      } catch (err) {
        // A clash on the random slug or the random invite code: try again with new ones.
        if (err instanceof UniqueViolation && ['leagues_slug_key', 'leagues_invite_code_key'].includes(err.constraint)) {
          continue;
        }
        throw err;
      }
      try {
        await repo.createMember({ leagueId: league.id, userId: user.id, name: myName, role: 'commissioner' });
      } catch (err) {
        // No commissioner-less leagues left behind. A failed rollback is logged, never allowed to
        // replace the error that actually happened.
        await repo.deleteLeague(league.id).catch((rollbackErr: unknown) => {
          console.error(`League rollback failed for ${league.id}`, rollbackErr);
        });
        throw err;
      }
      return json({ slug: league.slug, inviteCode: league.inviteCode }, 201);
    }
    throw new HttpError(500, 'Could not make a unique link. Try again.');
  });
}
