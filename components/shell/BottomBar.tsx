'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Trophy, UserRound } from '@/components/ui/icons';
import { appTab } from '@/lib/nav';

const TABS = [
  { id: 'home', label: 'Home', href: '/', Icon: Home },
  { id: 'leagues', label: 'Leagues', href: '/leagues', Icon: Trophy },
  { id: 'you', label: 'You', href: '/you', Icon: UserRound },
] as const;

/** The always-visible Home / Leagues / You bar, fixed to the bottom at every width. */
export function BottomBarView({ pathname }: { pathname: string }) {
  const current = appTab(pathname);
  return (
    <nav
      aria-label="App"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-2xl px-2">
        {TABS.map(({ id, label, href, Icon }) => {
          const active = current === id;
          return (
            <li key={id} className="flex flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'relative flex min-h-14 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5',
                  'text-[12px] font-semibold leading-4 motion-safe:transition-colors duration-150',
                  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  active
                    ? 'text-fg before:absolute before:inset-x-6 before:top-0 before:h-[3px] before:rounded-b-full before:bg-accent'
                    : 'text-fg-muted hover:text-fg',
                ].join(' ')}
              >
                <Icon className="size-6 shrink-0" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function BottomBar() {
  return <BottomBarView pathname={usePathname() ?? '/'} />;
}
