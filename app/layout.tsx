import type { Metadata, Viewport } from 'next';
import { Barlow, Barlow_Condensed } from 'next/font/google';
import { ExternalLink } from '@/components/ui/icons';
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

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

/** Hex-nut mark: gold hexagon with a blue bore. Decorative. */
function Mark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="size-7 shrink-0">
      <path d="M12 1.5 21.1 6.75v10.5L12 22.5 2.9 17.25V6.75Z" className="fill-accent" />
      <circle cx="12" cy="12" r="4" className="fill-none stroke-primary-strong" strokeWidth={2.5} />
    </svg>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlowCondensed.variable} ${barlow.variable}`}>
      <body className="flex min-h-dvh flex-col bg-bg font-body text-fg">
        <header className="sticky top-0 z-20 bg-primary text-on-primary shadow-md">
          <div className="mx-auto flex h-14 w-full max-w-2xl items-center px-4 md:max-w-3xl">
            <div className="flex items-center gap-2">
              <Mark />
              <span className="font-display text-2xl font-bold uppercase leading-none tracking-wide">
                FRC FANTASY
              </span>
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 pb-24 md:max-w-3xl">{children}</div>

        <footer className="mx-auto w-full max-w-2xl px-4 pb-6 text-center md:max-w-3xl">
          <a
            href="https://www.thebluealliance.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-sm text-fg-muted underline-offset-4 motion-safe:transition-colors duration-200 hover:text-fg hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            Scores from The Blue Alliance
            <ExternalLink className="size-3.5" />
          </a>
        </footer>
      </body>
    </html>
  );
}
