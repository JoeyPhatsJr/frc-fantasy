import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SignInForm } from '@/components/SignInForm';
import { safeNext } from '@/lib/auth/next';
import { getUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Sign in — FRC Fantasy' };

type Props = { searchParams: Promise<{ next?: string; mode?: string }> };

/**
 * /signin (landing redesign 2026-09-30): the header's "Sign in" and the landing page's
 * "Create an account" both land here. `?mode=signup` opens in create-account mode; `next` is where
 * to go afterwards (sanitized). Already signed in → straight to `next`.
 */
export default async function SignInPage({ searchParams }: Props) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getUser()) redirect(next);
  return (
    <main id="main" className="max-w-sm pt-2">
      <SignInForm next={next} initialMode={sp.mode === 'signup' ? 'signup' : 'signin'} heading />
    </main>
  );
}
