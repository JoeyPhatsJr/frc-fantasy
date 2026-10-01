import { Leaderboard } from '@/components/Leaderboard';
import { BumperPlate } from '@/components/ui/BumperPlate';

// Static demo (spec §4.6): explains scoring by showing it. Numbers are illustrative.
const ROWS = [
  { id: 'a', rank: 1, name: 'Mom', total: 184 },
  { id: 'b', rank: 2, name: 'Sis', total: 171 },
  { id: 'c', rank: 3, name: 'Dad', total: 142 },
  { id: 'd', rank: 4, name: 'Grandpa', total: 97 },
];

const Points = ({ children }: { children: string }) => (
  <span className="font-semibold text-accent-text tabular-nums">{children}</span>
);

/** The landing page's one card: a family league's season standings and how one team scored. */
export function SampleScoreboard() {
  return (
    // One elevation per theme: a border in dark (no shadows there), the soft card shadow alone in light.
    <div className="rounded-card border border-border bg-surface p-3 shadow-card [[data-theme=light]_&]:border-transparent">
      <Leaderboard rows={ROWS} emptyText="" animate={false} />
      <p className="mt-3 text-pretty border-t border-border px-1 pt-3 text-[15px] leading-[26px] text-fg">
        <BumperPlate number="341" size="sm" className="align-[-5px]" /> earned <Points>+10</Points> for rank,{' '}
        <Points>+8</Points> as a captain and <Points>+15</Points> for winning the event.
      </p>
    </div>
  );
}
