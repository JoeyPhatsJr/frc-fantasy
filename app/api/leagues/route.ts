import { z } from 'zod';
import { handle, HttpError, json, parseBody } from '@/lib/api/http';
import { generateAdminToken, hashToken, makeSlug, safeEqual } from '@/lib/auth/commissioner';
import { getRepo } from '@/lib/db';
import { UniqueViolation } from '@/lib/db/repo';
import { defaultScoring } from '@/lib/scoring/config';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  name: z
    .string('League name is required')
    .trim()
    .min(1, 'League name is required')
    .max(80, 'League name must be 80 characters or fewer'),
  passcode: z.string('Passcode is required').max(200, 'Passcode is too long'),
});

export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const body = await parseBody(req, bodySchema);
    const expected = process.env.CREATE_LEAGUE_PASSCODE;
    if (!expected || !safeEqual(body.passcode, expected)) throw new HttpError(403, 'Wrong passcode');

    const adminToken = generateAdminToken();
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const league = await getRepo().createLeague({
          slug: makeSlug(body.name),
          name: body.name,
          adminTokenHash: hashToken(adminToken),
          defaultScoring: defaultScoring(),
        });
        return json({ slug: league.slug, adminToken }, 201);
      } catch (err) {
        if (err instanceof UniqueViolation && err.constraint === 'leagues_slug_key') continue;
        throw err;
      }
    }
    throw new HttpError(500, 'Could not make a unique link. Try again.');
  });
}
