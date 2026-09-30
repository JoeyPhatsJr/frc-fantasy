import { NextResponse } from 'next/server';
import { ensureProfile } from '@/lib/auth/profile';
import { safeNext } from '@/lib/auth/next';
import { getRepo } from '@/lib/db';
import { createServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** OAuth lands here (spec §4.1): code → session cookie → profile → `next`. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const fail = NextResponse.redirect(new URL('/?auth_error=1', url.origin));
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.has('error')) return fail;

  let supabase: Awaited<ReturnType<typeof createServerSupabase>> | null = null;
  try {
    supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) return fail;
    await ensureProfile(getRepo(), data.user);
  } catch (err) {
    console.error(err);
    // The exchange may already have set the session cookies. Without a profile row, joining, creating
    // and Settings all fail, so undo the half-finished sign-in: signed out, the landing shows
    // "Sign-in didn't finish" and a retry creates the profile. 'local' only clears the cookies,
    // so it works even when Supabase is the thing that just failed.
    if (supabase) await supabase.auth.signOut({ scope: 'local' }).catch((e: unknown) => console.error(e));
    return fail;
  }
  return NextResponse.redirect(new URL(safeNext(url.searchParams.get('next')), url.origin));
}
