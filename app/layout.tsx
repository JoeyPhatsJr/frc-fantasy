import type { Metadata, Viewport } from 'next';
import { Barlow, Barlow_Condensed } from 'next/font/google';
import Link from 'next/link';
import { AppTabBar } from '@/components/AppTabBar';
import { HeaderAccount, type HeaderUser } from '@/components/HeaderAccount';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';
import { THEME_BOOT_SCRIPT } from '@/lib/theme';
import './globals.css';

const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-barlow-condensed',
  display: 'swap',
});

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-barlow',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'FRC Fantasy',
  description: 'Fantasy drafts for FIRST Robotics Competition events.',
};

// viewport-fit=cover turns on env(safe-area-inset-*) so the bottom tab bar clears the iPhone home indicator.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

/** Hex-nut mark: gold hexagon with a blue bore. Decorative. */
function Mark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="size-7 shrink-0">
      <path d="M12 1.5 21.1 6.75v10.5L12 22.5 2.9 17.25V6.75Z" className="fill-accent" />
      <circle cx="12" cy="12" r="4" className="fill-none stroke-primary-strong" strokeWidth={2.5} />
    </svg>
  );
}

async function loadHeaderUser(): Promise<HeaderUser> {
  try {
    const user = await getUser();
    if (!user) return null;
    const profile = await getRepo().getProfile(user.id);
    return { displayName: profile?.displayName ?? 'Player', avatarUrl: profile?.avatarUrl ?? null };
  } catch (err) {
    console.error(err); // a sleeping database or missing env var: render signed-out rather than a blank page
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headerUser = await loadHeaderUser();
  return (
    // Light by default. The boot script swaps in a saved choice before React hydrates, so the
    // attribute can legitimately differ from the server markup.
    <html
      lang="en"
      data-theme="light"
      className={`${barlowCondensed.variable} ${barlow.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col bg-bg font-body text-fg">
        <header className="sticky top-0 z-30 border-b border-border bg-surface">
          <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-3 px-4 md:max-w-3xl">
            <Link
              href="/"
              className="-ml-1 flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-1 text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Mark />
              <span className="font-display text-2xl font-bold uppercase leading-none tracking-wide">
                FRC FANTASY
              </span>
            </Link>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <HeaderAccount user={headerUser} />
            </div>
          </div>
        </header>

        {/* Signed in, the footer clears the fixed bottom tab bar on phones; signed out there is no tab
            bar (league pages' TabBar pads <body> itself, see globals.css), so no extra space. */}
        <div
          className={`mx-auto w-full max-w-2xl flex-1 px-4 py-6 md:max-w-3xl md:pb-8 ${headerUser ? 'pb-24' : 'pb-10'}`}
        >
          {children}
        </div>
        {headerUser ? <AppTabBar /> : null}

        <footer
          className={`mx-auto w-full max-w-2xl px-4 text-center md:max-w-3xl md:pb-6 ${headerUser ? 'pb-24' : 'pb-6'}`}
        >
          <p className="py-3 text-sm leading-6 text-fg-muted">
            Made by students on FRC Team 5181.{' '}
            <a
              href="https://www.thebluealliance.com"
              target="_blank"
              rel="noopener noreferrer"
              className="cursor-pointer rounded-sm py-3 underline decoration-fg-muted/40 underline-offset-4 hover:text-fg hover:decoration-current focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              Data from The Blue Alliance<span className="sr-only"> (opens in a new tab)</span>
            </a>
            . Not affiliated with FIRST.
          </p>
        </footer>
      </body>
    </html>
  );
}
