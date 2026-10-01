import { z } from 'zod';
import { handle, json, parseBody } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';
import { nameSchema } from '@/lib/leagues/names';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .strictObject({
    displayName: nameSchema.optional(),
    frcTeam: z
      .number('FRC team must be a number')
      .int('FRC team must be a whole number')
      .min(1, 'FRC team must be between 1 and 99999')
      .max(99999, 'FRC team must be between 1 and 99999')
      .nullable()
      .optional(),
  })
  .refine((v) => v.displayName !== undefined || v.frcTeam !== undefined, { message: 'Nothing to change' });

/** /me/settings (spec §4.2). Changing the display name doesn't rename you inside existing leagues. */
export async function PATCH(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const patch = await parseBody(req, bodySchema);
    const profile = await getRepo().updateProfile(user.id, patch);
    return json({ profile });
  });
}
