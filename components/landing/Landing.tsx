import { InviteCodeBox } from '@/components/InviteCodeBox';
import { SampleScoreboard } from '@/components/landing/SampleScoreboard';
import { Alert } from '@/components/ui/Alert';
import { BumperPlate } from '@/components/ui/BumperPlate';
import { Button } from '@/components/ui/Button';
import { ChevronDown } from '@/components/ui/icons';
import { Row } from '@/components/ui/Row';
import { Section } from '@/components/ui/Section';
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
      <span className="text-center font-display text-[22px] font-semibold leading-[26px] text-band-muted">vs</span>
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
    <main id="main" className="space-y-8 pb-4">
      {/* Broadcast band: full-bleed to the edges of the content column. -mt-6 cancels the content
          wrapper's top padding, so it meets the dark app header with no strip of page between them. */}
      <section data-hero className="-mx-4 -mt-6 space-y-8 bg-band px-4 py-8 text-on-band">
        <div className="space-y-4">
          <h1 className="text-balance font-display text-[44px] font-bold leading-[44px] tracking-[-0.01em] text-on-band md:text-[64px] md:leading-[64px]">
            <span className="block">Draft FRC teams.</span>
            <span className="block">Watch every match.</span>
            <span className="block">Roast your friends.</span>
          </h1>
          <p className="max-w-md text-pretty text-[17px] leading-6 text-band-muted">
            Fantasy leagues for FIRST Robotics, scored from real results on The Blue Alliance.
          </p>
        </div>
        <MatchLineup />
      </section>

      <div className="space-y-2">
        {authError ? <Alert tone="danger">Sign-in didn&apos;t finish — try again.</Alert> : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button href={signupHref(next)} className="w-full sm:w-auto sm:px-8">
            Create an account
          </Button>
          <Button href="/signin" variant="secondary" className="w-full sm:w-auto sm:px-8">
            Sign in
          </Button>
        </div>
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

      <Section label="A league in the middle of a season">
        <SampleScoreboard />
      </Section>

      <Section label="How it works">
        {STEPS.map((s, i) => (
          <Row
            key={s.title}
            leading={<span className="w-6 text-center font-display text-[22px] font-bold leading-none text-primary tabular-nums">{i + 1}</span>}
            title={s.title}
            subtitle={s.text}
          />
        ))}
      </Section>

      {upcoming.length > 0 ? (
        <Section label="Coming up">
          {upcoming.map((e) => (
            <Row
              key={e.key}
              title={e.name}
              subtitle={formatDateRange(e.start_date, e.end_date)}
              href={`/leagues/new?event=${e.key}`}
              trailing={<span className="text-sm font-semibold text-primary">Start a league</span>}
            />
          ))}
        </Section>
      ) : null}
    </main>
  );
}
