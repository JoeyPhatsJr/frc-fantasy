import type { Metadata, Viewport } from 'next';
import { Barlow, Barlow_Condensed } from 'next/font/google';
import { SkipLink } from '@/components/SkipLink';
import { AppHeader } from '@/components/shell/AppHeader';
import { BottomBar } from '@/components/shell/BottomBar';
import { getUser } from '@/lib/auth/session';
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
// themeColor tints the mobile browser chrome; the values are the header band (--color-band) per theme.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#14171f' },
    { media: '(prefers-color-scheme: dark)', color: '#080b11' },
  ],
};

async function isSignedIn(): Promise<boolean> {
  try {
    return (await getUser()) !== null;
  } catch (err) {
    console.error(err); // a sleeping database or missing env var: render signed-out rather than a blank page
    return false;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const signedIn = await isSignedIn();
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
        <SkipLink />
        <AppHeader signedIn={signedIn} />

        {/* Signed in, the footer clears the fixed bottom bar; signed out there is no bottom
            bar at all (league tabs live in the band at the top), so no extra space. */}
        <div
          className={`mx-auto w-full max-w-2xl flex-1 px-4 py-6 ${signedIn ? 'pb-28' : 'pb-10'}`}
        >
          {children}
        </div>
        {signedIn ? <BottomBar /> : null}

        <footer
          className={`mx-auto w-full max-w-2xl px-4 text-center ${signedIn ? 'pb-24' : 'pb-6'}`}
        >
          <p className="py-3 text-sm leading-6 text-fg-muted">
            Made by students on FRC Team 5181.{' '}
            <a
              href="https://www.thebluealliance.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block cursor-pointer rounded-sm py-3 underline decoration-fg-muted/40 underline-offset-4 hover:text-fg hover:decoration-current focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
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
