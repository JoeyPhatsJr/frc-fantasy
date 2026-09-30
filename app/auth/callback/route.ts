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

  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) return fail;
    await ensureProfile(getRepo(), data.user);
  } catch (err) {
    console.error(err);
    return fail;
  }
  return NextResponse.redirect(new URL(safeNext(url.searchParams.get('next')), url.origin));
}
