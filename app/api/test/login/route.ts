import { z } from 'zod';
import { handle, json, jsonError, parseBody } from '@/lib/api/http';
import { ensureProfile } from '@/lib/auth/profile';
import { testLoginAllowed } from '@/lib/auth/testLogin';
import { getRepo } from '@/lib/db';
import { createSupabaseClient } from '@/lib/db/supabaseRepo';
import { createServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ email: z.email(), name: z.string().max(40).optional() });

/**
 * E2E only (spec §8.1, §9): signs a Playwright browser in as a Supabase admin-created user,
 * without going through the email + password form. 404 everywhere else.
 */
export async function POST(req: Request): Promise<Response> {
  if (!testLoginAllowed(req, { E2E_AUTH_SECRET: process.env.E2E_AUTH_SECRET, VERCEL: process.env.VERCEL })) {
    return jsonError(404, 'Not found');
  }
  return handle(async () => {
    const { email, name } = await parseBody(req, bodySchema);
    const admin = createSupabaseClient().auth.admin;
    // Creating an existing user fails harmlessly; generateLink works either way.
    await admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name ?? email.split('@')[0] } });
    const { data, error } = await admin.generateLink({ type: 'magiclink', email });
    if (error || !data.properties?.hashed_token) throw new Error(error?.message ?? 'No magic link token');

    const supabase = await createServerSupabase(); // sets the session cookies on this response
    const verified = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: data.properties.hashed_token });
    if (verified.error || !verified.data.user) throw new Error(verified.error?.message ?? 'verifyOtp failed');
    await ensureProfile(getRepo(), verified.data.user);
    return json({ userId: verified.data.user.id });
  });
}
