import { BumperPlate } from '@/components/ui/BumperPlate';
import { Button } from '@/components/ui/Button';
import { ordinal, shortDate } from '@/lib/format';
import { teamLabel } from '@/lib/teams';
import type { UpNext } from '@/lib/views/upNext';

type Copy = { eyebrow: string; title: string; detail: string; action: { label: string; href: string } | null };

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

/** The words on the Up next card for each kind (spec §6.1). Pure so the table can be tested. */
export function upNextCopy(next: Exclude<UpNext, null>): Copy {
  const { kind, item } = next;
  const eyebrow = `UP NEXT · ${item.leagueName.toUpperCase()}`;
  const eventHref = `/l/${item.leagueSlug}/r/${item.roundId}`;
  const draftHref = `${eventHref}/draft`;
  const ev = item.eventName;
  switch (kind) {
    case 'draft-live':
      return {
        eyebrow,
        title: item.draftPhase === 'paused' ? 'Draft paused' : item.myTurn ? 'Your pick!' : 'Draft is live',
        detail: `${ev} · ${item.leagueName}`,
        action: { label: 'Open draft room', href: draftHref },
      };
    case 'event-live':
      return {
        eyebrow,
        title: item.myRank === null ? `${ev} is live` : `You're ${ordinal(item.myRank)} at ${ev}`,
        detail: item.myPoints === null ? item.leagueName : `${item.myPoints} pts · ${item.leagueName}`,
        action: { label: 'See scores', href: eventHref },
      };
    case 'results':
      return {
        eyebrow,
        title: item.myRank === null ? `${ev} is final` : `You finished ${ordinal(item.myRank)} at ${ev}${MEDALS[item.myRank] ? ` ${MEDALS[item.myRank]}` : ''}`,
        detail: item.winnerName ? `${item.winnerName} won · ${item.leagueName}` : item.leagueName,
        action: { label: 'See results', href: eventHref },
      };
    case 'event-soon':
      return {
        eyebrow,
        title: `${ev} starts ${shortDate(item.startDate)}`,
        detail: item.myTeams.length > 0 ? `Your teams: ${item.myTeams.map(teamLabel).join(', ')}` : item.leagueName,
        action: { label: 'See your teams', href: eventHref },
      };
    case 'draft-soon':
      return {
        eyebrow,
        title: `${ev} draft coming up`,
        detail: `${shortDate(item.startDate)} · ${item.leagueName}`,
        action: { label: 'Open draft room', href: draftHref },
      };
  }
}

/** The one hero card on Home (spec §6.1). */
export function UpNextCard({ next }: { next: UpNext }) {
  if (!next) {
    return (
      <section aria-label="Up next" className="space-y-1 rounded-card border border-accent bg-surface p-4">
        <p className="text-[11px] font-bold uppercase tracking-[.12em] text-accent-text">UP NEXT</p>
        <p className="font-display text-[28px] font-bold leading-8 text-fg">Nothing on right now</p>
        <p className="text-fg-muted">Your next event will show up here.</p>
      </section>
    );
  }
  const c = upNextCopy(next);
  const showPlates = (next.kind === 'event-soon' || next.kind === 'draft-soon') && next.item.myTeams.length > 0;
  return (
    <section aria-label="Up next" className="space-y-3 rounded-card border border-accent bg-surface p-4">
      <p className="text-[11px] font-bold uppercase tracking-[.12em] text-accent-text">{c.eyebrow}</p>
      <h2 className="font-display text-[28px] font-bold leading-8 text-fg">{c.title}</h2>
      {showPlates ? (
        <div className="flex flex-wrap gap-2">
          {next.item.myTeams.map((key) => (
            <BumperPlate key={key} number={teamLabel(key)} size="sm" />
          ))}
        </div>
      ) : (
        <p className="text-fg-muted">{c.detail}</p>
      )}
      {c.action ? (
        <Button href={c.action.href} variant="accent" className="w-full">
          {c.action.label}
        </Button>
      ) : null}
    </section>
  );
}
