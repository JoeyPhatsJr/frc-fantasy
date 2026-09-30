import { CreateLeagueForm } from '@/components/CreateLeagueForm';
import { BumperPlate, type BumperSide } from '@/components/ui/BumperPlate';

// Real team numbers in alternating alliance colours: the hero's only visual.
const STRIP: { number: string; side: BumperSide }[] = [
  { number: '341', side: 'blue' },
  { number: '5181', side: 'red' },
  { number: '2607', side: 'blue' },
  { number: '103', side: 'red' },
  { number: '9998', side: 'blue' },
];

export default function HomePage() {
  return (
    <main id="main" className="space-y-8">
      <header className="space-y-5 pt-4">
        <div className="space-y-3">
          {/* The wordmark is the one place the app uses capitals. */}
          <h1 className="font-display text-[48px] font-bold uppercase leading-[48px] text-fg">FRC Fantasy</h1>
          <p className="text-[17px] leading-6 text-fg">
            Draft FIRST Robotics teams before each event, then watch their real results turn into points.
          </p>
        </div>
        {/* Decorative: the plates wrap onto a second line on narrow phones instead of scrolling. */}
        <div aria-hidden="true" className="flex flex-wrap gap-2">
          {STRIP.map(({ number, side }) => (
            <BumperPlate key={number} number={number} side={side} size="lg" />
          ))}
        </div>
        <p className="text-[15px] text-fg-muted">Looking for your league? Use the link from your group chat.</p>
      </header>
      <CreateLeagueForm />
    </main>
  );
}
