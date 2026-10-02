'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Trophy, UserRound } from '@/components/ui/icons';
import { appTab, showAppTabBar } from '@/lib/nav';

const TABS = [
  { id: 'home', label: 'Me', href: '/', Icon: UserRound },
  { id: 'leagues', label: 'Leagues', href: '/leagues', Icon: Trophy },
] as const;

/** Signed-in bottom bar (spec §4.6). Same look as the league TabBar. */
export function AppTabBarView({ pathname }: { pathname: string }) {
  if (!showAppTabBar(pathname)) return null;
  const current = appTab(pathname);
  return (
    <nav
      aria-label="App"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:static md:border-t-0 md:bg-transparent md:pb-0"
    >
      <ul className="mx-auto flex max-w-2xl px-2 md:max-w-3xl md:justify-center md:gap-1">
        {TABS.map(({ id, label, href, Icon }) => {
          const active = current === id;
          return (
            <li key={id} className="flex flex-1 md:flex-none">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex min-h-16 w-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl',
                  'text-[13px] font-semibold leading-[18px] motion-safe:transition-colors duration-150',
                  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  'md:min-h-11 md:flex-row md:gap-2 md:rounded-pill md:px-4 md:text-[15px]',
                  active
                    ? 'relative text-primary before:absolute before:inset-x-6 before:top-0 before:h-[3px] before:rounded-b-full before:bg-primary md:bg-primary-fill md:text-on-primary md:before:hidden'
                    : 'text-fg-muted hover:text-fg md:hover:bg-surface-2',
                ].join(' ')}
              >
                <Icon className="size-6 shrink-0 md:size-5" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AppTabBar() {
  return <AppTabBarView pathname={usePathname() ?? '/'} />;
}
