import { Row } from '@/components/ui/Row';
import { teamLabel } from '@/lib/teams';
import type { MeSeason } from '@/lib/views/home';

const num = 'font-display text-[22px] font-bold tabular-nums text-fg';

/** Season totals on the You page (spec §6.3): every number has a label. */
export function MySeason({ season, year }: { season: MeSeason; year: string }) {
  const best = season.bestPick;
  return (
    <>
      <Row title={`${season.total.toLocaleString('en-US')} points in ${year}`} />
      <Row
        title="Best pick"
        subtitle={best ? `${teamLabel(best.teamKey)} at ${best.eventName} (+${best.points})` : '—'}
      />
      <Row
        title="Average finish"
        trailing={<span className={num}>{season.averageFinish === null ? '—' : season.averageFinish.toFixed(1)}</span>}
      />
    </>
  );
}
