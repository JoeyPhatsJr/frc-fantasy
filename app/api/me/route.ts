import { handle, noContent } from '@/lib/api/http';
import { deleteAccount } from '@/lib/account/deleteAccount';
import { requireUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';
import { createServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    await deleteAccount(getRepo(), user.id);
    try {
      await (await createServerSupabase()).auth.signOut(); // clear the cookie; the user is already gone
    } catch {
      // Nothing to do: the next request simply has no valid session.
    }
    return noContent();
  });
}
