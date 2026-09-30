'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Flag, ListOrdered, Settings2, type IconProps } from '@/components/ui/icons';
import { activeTab, type LeagueTab } from '@/lib/nav';

type Tab = { id: LeagueTab; label: string; href: string; Icon: (props: IconProps) => ReactNode };

/**
 * League navigation. Small screens: a fixed bottom bar (64px plus the iPhone home-indicator inset).
 * From md up: the same links as a segmented control under the league bar.
 */
export function TabBar({ slug, targetRoundId, showAdmin }: { slug: string; targetRoundId: string | null; showAdmin: boolean }) {
  const pathname = usePathname();
  const current = activeTab(pathname ?? '', slug);

  const tabs: Tab[] = [{ id: 'standings', label: 'Standings', href: `/l/${slug}`, Icon: ListOrdered }];
  if (targetRoundId) tabs.push({ id: 'round', label: 'Round', href: `/l/${slug}/r/${targetRoundId}`, Icon: Flag });
  if (showAdmin) tabs.push({ id: 'admin', label: 'Admin', href: `/l/${slug}/admin`, Icon: Settings2 });

  return (
    <nav
      aria-label="League"
      data-tabbar
      className={[
        'fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]',
        'md:static md:z-auto md:mt-3 md:border-t-0 md:bg-transparent md:pb-0',
      ].join(' ')}
    >
      <ul
        className={[
          'mx-auto flex max-w-2xl px-2',
          'md:inline-flex md:max-w-none md:gap-1 md:rounded-pill md:border md:border-border md:bg-surface md:p-1',
        ].join(' ')}
      >
        {tabs.map(({ id, label, href, Icon }) => {
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
                  // Small screens mark the active tab with a short rail along the bar's top edge.
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
