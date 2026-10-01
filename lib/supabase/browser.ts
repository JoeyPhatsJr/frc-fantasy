'use client';

import { createBrowserClient } from '@supabase/ssr';

// NEXT_PUBLIC_* must be written out literally so Next.js inlines them into the browser bundle.
// Used for email + password sign-in/sign-up (auth only); the browser never queries the database.
export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
  );
}
