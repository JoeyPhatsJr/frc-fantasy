'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { oauthRedirectUrl } from '@/lib/auth/next';
import { createBrowserSupabase } from '@/lib/supabase/browser';

type Provider = 'google' | 'discord';

/** "Continue with Google / Discord" (spec §4.1). `next` is where to land after signing in. */
export function SignInButtons({ next = '/' }: { next?: string }) {
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(provider: Provider) {
    setBusy(provider);
    setError(null);
    const { error: err } = await createBrowserSupabase().auth.signInWithOAuth({
      provider,
      options: { redirectTo: oauthRedirectUrl(window.location.origin, next) },
    });
    // On success the browser is already leaving for the provider; only failures come back here.
    if (err) {
      setError("Sign-in didn't start. Try again.");
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button type="button" busy={busy === 'google'} disabled={busy !== null} onClick={() => signIn('google')}>
        Continue with Google
      </Button>
      <Button
        type="button"
        variant="secondary"
        busy={busy === 'discord'}
        disabled={busy !== null}
        onClick={() => signIn('discord')}
      >
        Continue with Discord
      </Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
