import Link from 'next/link';
import { InviteCodeBox } from '@/components/InviteCodeBox';
import { SampleScoreboard } from '@/components/landing/SampleScoreboard';
import { Alert } from '@/components/ui/Alert';
import { BumperPlate } from '@/components/ui/BumperPlate';
import { Button } from '@/components/ui/Button';
import { ChevronDown } from '@/components/ui/icons';
import { formatDateRange } from '@/lib/format';
import type { TbaEvent } from '@/lib/tba/types';

// A real sequence, so a numbered list (not three cards).
const STEPS = [
  { title: 'Draft', text: 'Snake draft FRC teams before an event, from your phone.' },
  { title: 'Watch', text: 'Your teams score points from their real match results.' },
  { title: 'Win', text: 'Rounds add up to season standings.' },
];

// An FRC match is three robots per alliance. Real team numbers.
const BLUE = ['341', '2607', '5181'];
const RED = ['1114', '254', '118'];

// Section titles step up at md, where the 64px hero would otherwise dwarf them.
const SECTION_TITLE = 'font-display text-[22px] font-bold leading-[26px] text-fg md:text-[28px] md:leading-[30px]';

/**
 * The page's one bold element: a match lineup, blue alliance vs red. Decorative. On phones each
 * alliance is a row of three equal plates (so the two rows line up like a match card) with "vs"
 * centred between them; from md the whole match sits on one line.
 */
export function MatchLineup() {
  const plate = 'w-full'; // fill the grid cell; min-w-20 still fits 3 per row at 360px
  return (
    <div
      aria-hidden="true"
      data-match-lineup
      className="grid gap-2 md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-4"
    >
      <div className="grid grid-cols-3 gap-2">
        {BLUE.map((n) => (
          <BumperPlate key={n} number={n} side="blue" size="lg" className={plate} />
        ))}
      </div>
      <span className="text-center font-display text-[22px] font-semibold leading-[26px] text-fg-muted">vs</span>
      <div className="grid grid-cols-3 gap-2">
        {RED.map((n) => (
          <BumperPlate key={n} number={n} side="red" size="lg" className={plate} />
        ))}
      </div>
    </div>
  );
}

function signupHref(next: string): string {
  return next === '/' ? '/signin?mode=signup' : `/signin?mode=signup&next=${encodeURIComponent(next)}`;
}

export function Landing({ upcoming, authError, next }: { upcoming: TbaEvent[]; authError: boolean; next: string }) {
  return (
    <main id="main" className="space-y-12 pb-4">
      <section className="space-y-8 pt-2">
        <div className="space-y-4">
          <h1 className="text-balance font-display text-[44px] font-bold leading-[44px] tracking-[-0.01em] text-fg md:text-[64px] md:leading-[64px]">
            <span className="block">Draft FRC teams.</span>
            <span className="block">Watch every match.</span>
            <span className="block">Roast your friends.</span>
          </h1>
          <p className="max-w-md text-pretty text-[17px] leading-6 text-fg-muted">
            Fantasy leagues for FIRST Robotics, scored from real results on The Blue Alliance.
          </p>
        </div>

        <div className="space-y-2">
          {authError ? <Alert tone="danger">Sign-in didn&apos;t finish — try again.</Alert> : null}
          <Button href={signupHref(next)} className="w-full sm:w-auto sm:px-8">
            Create an account
          </Button>
          {/* No JS needed: <details> opens before hydration too. */}
          <details className="group">
            <summary className="-ml-1 inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg px-1 font-semibold text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              Have an invite code?
              <ChevronDown className="size-4 motion-safe:transition-transform group-open:rotate-180" />
            </summary>
            <div className="max-w-sm pt-2 motion-safe:animate-fade-up">
              <InviteCodeBox label="Invite code" />
            </div>
          </details>
        </div>

        <MatchLineup />
      </section>

      <section className="space-y-4">
        <h2 className={SECTION_TITLE}>A league in the middle of a season</h2>
        <SampleScoreboard />
      </section>

      <section className="space-y-2">
        <h2 className={SECTION_TITLE}>How it works</h2>
        <ol className="divide-y divide-border">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4 py-4">
              <span className="w-6 shrink-0 font-display text-[28px] font-bold leading-[30px] text-primary tabular-nums">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[17px] font-semibold leading-6 text-fg">{s.title}</span>
                <span className="block text-[15px] leading-[22px] text-fg-muted">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {upcoming.length > 0 ? (
        <section className="space-y-2">
          <h2 className={SECTION_TITLE}>Coming up</h2>
          <ul className="divide-y divide-border">
            {upcoming.map((e) => (
              <li key={e.key} className="flex items-center justify-between gap-4 py-3">
                <span className="min-w-0">
                  <span className="block font-semibold leading-6 text-fg">{e.name}</span>
                  <span className="block text-sm text-fg-muted">{formatDateRange(e.start_date, e.end_date)}</span>
                </span>
                <Link
                  href={`/leagues/new?event=${e.key}`}
                  aria-label={`Start a league for ${e.name}`}
                  className="-mr-2 flex min-h-11 shrink-0 cursor-pointer items-center rounded-lg px-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Start a league
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
