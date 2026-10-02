'use client';

import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { showHeaderSignIn } from '@/lib/nav';

/** The header's gold "Sign in" for signed-out visitors; it steps aside on the sign-in page itself. */
export function HeaderSignInView({ pathname }: { pathname: string }) {
  if (!showHeaderSignIn(pathname)) return null;
  return (
    <Button href="/signin" size="sm" variant="accent">
      Sign in
    </Button>
  );
}

export function HeaderSignIn() {
  return <HeaderSignInView pathname={usePathname() ?? '/'} />;
}
