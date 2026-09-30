import type { ReactNode } from 'react';
import { CreateLeagueForm } from '@/components/CreateLeagueForm';
import { Activity, Trophy, Users, type IconProps } from '@/components/ui/icons';

const BENEFITS: { Icon: (props: IconProps) => ReactNode; text: string }[] = [
  { Icon: Users, text: 'Before an event, everyone takes turns drafting the teams that are competing.' },
  {
    Icon: Trophy,
    text: 'Your teams earn points for winning matches, ranking high, getting picked for playoff alliances, and winning the event.',
  },
  { Icon: Activity, text: 'Scores come straight from The Blue Alliance.' },
];

export default function HomePage() {
  return (
    <main id="main" className="space-y-6">
      <header className="relative isolate -mx-4 -mt-6 space-y-5 px-4 pt-10 pb-2">
        {/* Soft primary glow at the top of the page (decorative, CSS only). */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-radial-[ellipse_at_top] from-primary/25 to-transparent to-70%"
        />
        <div className="space-y-2">
          <h1 className="font-display text-5xl font-bold uppercase leading-none tracking-wide text-fg">
            FRC Fantasy
          </h1>
          <p className="text-lg font-medium text-fg">Fantasy drafts for FIRST Robotics Competition.</p>
        </div>
        <ul className="space-y-3">
          {BENEFITS.map(({ Icon, text }) => (
            <li key={text} className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-fill text-on-primary shadow-sm">
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 pt-1.5 text-fg">{text}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-fg-muted">Looking for your league? Use the link from your group chat.</p>
      </header>
      <CreateLeagueForm />
    </main>
  );
}
