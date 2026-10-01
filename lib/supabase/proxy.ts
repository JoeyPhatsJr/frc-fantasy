import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAuthEnv } from '@/lib/supabase/server';

/**
 * Refreshes the Supabase session cookie on every request (spec §4.1). It never redirects:
 * pages and routes decide what signed-out visitors see.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const { url, anonKey } = supabaseAuthEnv();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });
  // Nothing may run between creating the client and this call (Supabase's SSR guidance).
  try {
    await supabase.auth.getClaims();
  } catch {
    // A garbage cookie must not turn every request into a 500; pages treat it as signed out.
  }
  return response;
}
