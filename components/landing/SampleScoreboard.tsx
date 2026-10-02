import { BumperPlate } from '@/components/ui/BumperPlate';
import { Points, RankNumeral, Row } from '@/components/ui/Row';

// Static demo (spec §4.6): explains scoring by showing it. Numbers are illustrative.
const ROWS = [
  { id: 'a', rank: 1, name: 'Mom', total: 184 },
  { id: 'b', rank: 2, name: 'Sis', total: 171 },
  { id: 'c', rank: 3, name: 'Dad', total: 142 },
  { id: 'd', rank: 4, name: 'Grandpa', total: 97 },
];

const Pts = ({ children }: { children: string }) => (
  <span className="font-semibold text-accent-text tabular-nums">{children}</span>
);

/** The landing page's sample: a family league's season standings and how one team scored. */
export function SampleScoreboard() {
  return (
    <div>
      {ROWS.map((r) => (
        <Row key={r.id} leading={<RankNumeral rank={r.rank} />} title={r.name} trailing={<Points value={r.total} />} />
      ))}
      <p className="text-pretty border-b border-border px-4 py-3 text-[15px] leading-[26px] text-fg">
        <BumperPlate number="341" size="sm" className="align-[-5px]" /> earned <Pts>+10</Pts> for rank, <Pts>+8</Pts> as a
        captain and <Pts>+15</Pts> for winning the event.
      </p>
    </div>
  );
}
