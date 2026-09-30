import Link from 'next/link';
import { InviteCodeBox } from '@/components/InviteCodeBox';
import { SampleScoreboard } from '@/components/landing/SampleScoreboard';
import { SignInButtons } from '@/components/SignInButtons';
import { Alert } from '@/components/ui/Alert';
import { BumperPlate, type BumperSide } from '@/components/ui/BumperPlate';
import { Card } from '@/components/ui/Card';
import { formatDateRange } from '@/lib/format';
import type { TbaEvent } from '@/lib/tba/types';

const STEPS = [
  { title: 'Draft', text: 'Snake draft FRC teams live from your phone.' },
  { title: 'Watch', text: 'Points come from real results on The Blue Alliance.' },
  { title: 'Win', text: 'Rounds add up to season standings.' },
];

// Real team numbers in alternating alliance colours: the hero's only visual.
const STRIP: { number: string; side: BumperSide }[] = [
  { number: '341', side: 'blue' },
  { number: '5181', side: 'red' },
  { number: '2607', side: 'blue' },
  { number: '103', side: 'red' },
  { number: '9998', side: 'blue' },
];

export function Landing({ upcoming, authError, next }: { upcoming: TbaEvent[]; authError: boolean; next: string }) {
  return (
    <main id="main" className="space-y-8">
      <section className="space-y-5 pt-2">
        <h1 className="font-display text-[40px] font-bold uppercase leading-[42px] text-fg">
          Draft FRC teams. Watch every match. Roast your friends.
        </h1>
        <p className="text-[17px] leading-6 text-fg">
          Fantasy leagues for FIRST Robotics: draft teams before an event, then their real results turn into points.
        </p>
        {/* Decorative: the plates wrap onto a second line on narrow phones instead of scrolling. */}
        <div aria-hidden="true" className="flex flex-wrap gap-2">
          {STRIP.map(({ number, side }) => (
            <BumperPlate key={number} number={number} side={side} size="lg" />
          ))}
        </div>
        {authError ? <Alert tone="danger">Sign-in didn&apos;t finish — try again.</Alert> : null}
        <SignInButtons next={next} />
        <InviteCodeBox />
      </section>

      <SampleScoreboard />

      <section className="space-y-3">
        <h2 className="font-display text-[22px] font-bold text-fg">How it works</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <Card key={s.title} eyebrow={`Step ${i + 1}`} title={s.title}>
              <p className="text-[15px] text-fg-muted">{s.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-[22px] font-bold text-fg">Two ways to play</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card title="Event-by-event">
            <p className="text-[15px] text-fg-muted">A fresh draft before each event you follow. Rounds roll up into a season.</p>
          </Card>
          <Card title="Full season">
            <p className="text-[15px] text-fg-muted">Draft once; your teams score at every official event all season.</p>
          </Card>
        </div>
      </section>

      {upcoming.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-display text-[22px] font-bold text-fg">Coming up</h2>
          <Card>
            <ul className="-mx-2 divide-y divide-border">
              {upcoming.map((e) => (
                <li key={e.key} className="flex min-h-14 items-center justify-between gap-3 px-2 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-fg">{e.name}</span>
                    <span className="block text-sm text-fg-muted">{formatDateRange(e.start_date, e.end_date)}</span>
                  </span>
                  <Link
                    href={`/leagues/new?event=${e.key}`}
                    className="flex min-h-11 shrink-0 cursor-pointer items-center rounded-lg px-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Start a league for this event
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      <footer className="border-t border-border pt-4 text-sm text-fg-muted">
        Scores come from The Blue Alliance. Not affiliated with FIRST.
      </footer>
    </main>
  );
}
