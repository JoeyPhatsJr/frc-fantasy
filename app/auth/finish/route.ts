import { json } from '@/lib/api/http';
import { safeNext } from '@/lib/auth/next';
import { ensureProfile } from '@/lib/auth/profile';
import { getRepo } from '@/lib/db';
import { createServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const DIDNT_FINISH = "Sign-in didn't finish — try again.";

/**
 * Spec §4.1: after the browser signs in or signs up with Supabase Auth, it posts here.
 * The session cookie is already set; this makes sure the profile row exists.
 */
export async function POST(request: Request): Promise<Response> {
  let next: unknown = null;
  try {
    next = ((await request.json()) as { next?: unknown })?.next ?? null;
  } catch {
    // No body or not JSON: land on "/".
  }
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return json({ error: DIDNT_FINISH }, 401);
  try {
    await ensureProfile(getRepo(), data.user);
  } catch (err) {
    console.error(err);
    await supabase.auth.signOut(); // never leave someone signed in without a profile
    return json({ error: DIDNT_FINISH }, 500);
  }
  return json({ redirectTo: safeNext(typeof next === 'string' ? next : null) });
}
