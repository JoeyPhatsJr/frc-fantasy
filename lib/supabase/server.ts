import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Supabase *Auth* only. Database reads and writes still go through lib/db (service-role key).

export function supabaseAuthEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set');
  return { url, anonKey };
}

/** A per-request Auth client that reads and writes the session cookies. */
export async function createServerSupabase() {
  const { url, anonKey } = supabaseAuthEnv();
  const store = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. proxy.ts refreshes the
          // session on every request, so nothing is lost.
        }
      },
    },
  });
}
