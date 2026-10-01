'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/Button';

export type HeaderUser = { displayName: string; avatarUrl: string | null } | null;

export function HeaderAccountView({ user, pathname }: { user: HeaderUser; pathname: string }) {
  if (!user) {
    // On /signin the page is the sign-in form; a second "Sign in" would only repeat it.
    if (pathname === '/signin') return null;
    // Come back to this page after signing in; home needs no next.
    const href = pathname === '/' ? '/signin' : `/signin?next=${encodeURIComponent(pathname)}`;
    return (
      <Button href={href} variant="secondary" size="sm">
        Sign in
      </Button>
    );
  }
  return (
    <Link
      href="/me/settings"
      aria-label={`Account settings for ${user.displayName}`}
      className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      {user.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- provider avatars; no Next image config needed
        <img
          src={user.avatarUrl}
          alt=""
          width={32}
          height={32}
          referrerPolicy="no-referrer"
          className="size-8 rounded-full motion-safe:transition-opacity hover:opacity-80"
        />
      ) : (
        <span className="flex size-8 items-center justify-center rounded-full bg-primary-fill font-display text-lg font-bold text-on-primary motion-safe:transition-colors hover:bg-primary-strong">
          {user.displayName.slice(0, 1).toUpperCase()}
        </span>
      )}
    </Link>
  );
}

export function HeaderAccount({ user }: { user: HeaderUser }) {
  return <HeaderAccountView user={user} pathname={usePathname() ?? '/'} />;
}
