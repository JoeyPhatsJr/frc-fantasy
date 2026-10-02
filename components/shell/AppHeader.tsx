import Link from 'next/link';
import { HeaderSignIn } from '@/components/shell/HeaderSignIn';

/** Hex-nut mark: gold hexagon with a blue bore. Decorative. */
function Mark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="size-7 shrink-0">
      <path d="M12 1.5 21.1 6.75v10.5L12 22.5 2.9 17.25V6.75Z" className="fill-accent" />
      <circle cx="12" cy="12" r="4" className="fill-none stroke-primary-strong" strokeWidth={2.5} />
    </svg>
  );
}

/** The dark band across the top: wordmark home, and a Sign in button when signed out (not on /signin). */
export function AppHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-30 bg-band text-on-band">
      <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-3 px-4">
        <Link
          href="/"
          className="-ml-1 flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-1 text-on-band focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Mark />
          <span className="font-display text-2xl font-bold uppercase leading-none tracking-wide">
            FRC FANTASY
          </span>
        </Link>
        {signedIn ? null : <HeaderSignIn />}
      </div>
    </header>
  );
}
