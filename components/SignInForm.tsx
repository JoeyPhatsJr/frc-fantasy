'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { authErrorMessage, MIN_PASSWORD } from '@/lib/auth/passwordErrors';
import { cleanName, NAME_MAX } from '@/lib/leagues/names';
import { createBrowserSupabase } from '@/lib/supabase/browser';

type Mode = 'signin' | 'signup';

/** Spec §4.1: one form for "Sign in" and "Create account". `next` is where to land afterwards. */
/** The browser holds a session before /auth/finish runs; if finish fails, drop it so nobody stays signed in with no profile. */
async function dropSession() {
  try {
    await createBrowserSupabase().auth.signOut({ scope: 'local' });
  } catch {
    // best effort
  }
}

const HEADINGS: Record<Mode, { title: string; line: string }> = {
  signin: { title: 'Sign in', line: 'Use the email and password you signed up with.' },
  signup: { title: 'Create an account', line: 'Then start a league, or join one with an invite code.' },
};

export function SignInForm({
  next = '/',
  initialMode = 'signin',
  heading = false,
}: {
  next?: string;
  initialMode?: Mode;
  /** The /signin page: show a page title (h1) and one line that follow the mode as it toggles. */
  heading?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which field a client-side validation error is about (gets aria-invalid and focus).
  const [errorField, setErrorField] = useState<'name' | 'password' | null>(null);
  // Until hydration the submit handler isn't attached, so keep the button off rather than let a
  // native POST of the password happen.
  const [errorTick, setErrorTick] = useState(0); // re-focus even when the same message repeats
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const signup = mode === 'signup';

  function fail(message: string, field: 'name' | 'password' | null = null) {
    setError(message);
    setErrorField(field);
    setErrorTick((n) => n + 1);
  }

  // Move focus to the offending field, or to the alert when the error isn't about one field.
  useEffect(() => {
    if (!error) return;
    const field = errorField ? formRef.current?.querySelector<HTMLInputElement>(`[name="${errorField}"]`) : null;
    (field ?? alertRef.current)?.focus();
  }, [error, errorField, errorTick]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorField(null);
    const cleanEmail = email.trim();
    const displayName = signup ? cleanName(name) : null;
    if (signup && !displayName) return fail(`Enter your name (1–${NAME_MAX} characters).`, 'name');
    if (signup && password.length < MIN_PASSWORD) return fail(`Use at least ${MIN_PASSWORD} characters.`, 'password');
    setBusy(true);
    try {
      const auth = createBrowserSupabase().auth;
      const { error: authError } = signup
        ? await auth.signUp({ email: cleanEmail, password, options: { data: { full_name: displayName } } })
        : await auth.signInWithPassword({ email: cleanEmail, password });
      if (authError) {
        fail(authErrorMessage(authError));
        return;
      }
      const res = await fetch('/auth/finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ next }),
      });
      const body = (await res.json().catch(() => ({}))) as { redirectTo?: string; error?: string };
      if (!res.ok || !body.redirectTo) {
        await dropSession();
        fail(body.error ?? "Sign-in didn't finish — try again.");
        return;
      }
      window.location.assign(body.redirectTo);
    } catch {
      await dropSession();
      fail("Couldn't sign in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} method="post" onSubmit={submit} className="space-y-3" noValidate>
      {heading ? (
        <div className="space-y-1 pb-3">
          <h1 className="font-display text-[28px] font-bold leading-[30px] text-fg">{HEADINGS[mode].title}</h1>
          <p className="text-[15px] leading-[22px] text-fg-muted">{HEADINGS[mode].line}</p>
        </div>
      ) : null}
      {signup ? (
        <Input
          label="Your name"
          name="name"
          autoComplete="name"
          spellCheck={false}
          error={errorField === 'name' ? error : null}
          maxLength={NAME_MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      ) : null}
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete={signup ? 'new-password' : 'current-password'}
        minLength={signup ? MIN_PASSWORD : undefined}
        hint={signup ? `At least ${MIN_PASSWORD} characters.` : undefined}
        error={errorField === 'password' ? error : null}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && !errorField ? (
        <div ref={alertRef} tabIndex={-1} className="rounded-xl focus-visible:outline-hidden">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      <Button type="submit" busy={busy} disabled={!ready} className="w-full">
        {busy ? (signup ? 'Creating account…' : 'Signing in…') : signup ? 'Create account' : 'Sign in'}
      </Button>
      <button
        type="button"
        className="min-h-11 w-full cursor-pointer touch-manipulation rounded-lg text-sm text-fg-muted underline underline-offset-2 hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          setMode(signup ? 'signin' : 'signup');
          setError(null);
          setErrorField(null);
        }}
      >
        {signup ? 'Have an account? Sign in' : 'New here? Create account'}
      </button>
      {!signup ? (
        <p className="text-center text-sm text-fg-muted">Forgot your password? Ask the site admin to reset it.</p>
      ) : null}
    </form>
  );
}
