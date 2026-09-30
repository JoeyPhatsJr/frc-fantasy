import { Leaderboard } from '@/components/Leaderboard';
import { BumperPlate } from '@/components/ui/BumperPlate';
import { Card } from '@/components/ui/Card';

// Static demo (spec §4.6): explains scoring by showing it. Numbers are illustrative.
const ROWS = [
  { id: 'a', rank: 1, name: 'Mom', total: 184 },
  { id: 'b', rank: 2, name: 'Joey', total: 171 },
  { id: 'c', rank: 3, name: 'Dad', total: 142 },
  { id: 'd', rank: 4, name: 'Grandpa', total: 97 },
];

export function SampleScoreboard() {
  return (
    <Card eyebrow="Sample league" title="Ramp Riot standings" className="space-y-3">
      <Leaderboard rows={ROWS} emptyText="" />
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-3">
        <BumperPlate number="341" side="blue" />
        <p className="text-[15px] text-fg">
          <span className="font-semibold">341:</span> +10 rank · +8 captain · +15 winner
        </p>
      </div>
    </Card>
  );
}
