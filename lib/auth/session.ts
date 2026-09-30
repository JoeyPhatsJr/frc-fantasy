import { HttpError } from '@/lib/api/http';
import { createServerSupabase } from '@/lib/supabase/server';

// The ONLY module that reads the auth cookie (spec §3, §8.1). Tests replace it with tests/helpers/auth.ts.

export type SessionUser = { id: string; email: string | null };

/** The signed-in user, or null. getClaims() verifies the session JWT; an invalid one counts as signed out. */
export async function getUser(): Promise<SessionUser | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims as { sub?: unknown; email?: unknown } | undefined;
  if (error || !claims || typeof claims.sub !== 'string' || claims.sub === '') return null;
  return { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : null };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) throw new HttpError(401, 'Sign in first');
  return user;
}
