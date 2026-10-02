import { AdjustmentList } from '@/components/AdjustmentList';
import { EventSwitcher, type SwitcherRound } from '@/components/event/EventSwitcher';
import { PlayerBoard } from '@/components/event/PlayerBoard';
import { ScoringSheet } from '@/components/event/ScoringSheet';
import { Button } from '@/components/ui/Button';
import { Section } from '@/components/ui/Section';
import { StatusStrip } from '@/components/ui/StatusStrip';
import { tbaEventUrl } from '@/lib/format';
import { GLOSSARY } from '@/lib/glossary';
import type { RoundView } from '@/lib/views/round';
import { roundStrip } from '@/lib/views/roundStrip';
import { scoringSummary } from '@/lib/views/scoringSummary';

export type EventBodyProps = {
  slug: string;
  view: RoundView;
  rounds: SwitcherRound[];
  meId: string | null;
  playerNames: Record<string, string>;
  now: Date;
};

/** The Event tab layout (spec §6.5), shared by the round page and season-league Standings. */
export function EventBody({ slug, view, rounds, meId, playerNames, now }: EventBodyProps) {
  const { round } = view;
  const winner = view.scores.find((s) => s.rank === 1)?.name ?? null;
  const strip = roundStrip(
    {
      slug, roundId: round.id, eventName: round.eventName, startDate: round.startDate, endDate: round.endDate,
      status: view.status, kind: round.kind, fetchedAt: view.fetchedAt, stale: view.stale, winnerName: winner,
    },
    now,
  );
  const season = round.kind === 'season';
  const preDraft = view.status === 'setup' || view.status === 'drafting';
  const notes = [
    !view.hasEventData && !preDraft
      ? round.kind === 'manual' ? 'No results entered yet.' : season ? 'No events yet this season.' : "The event hasn't started yet."
      : null,
    view.hasEventData && !view.qualsComplete && !season ? `${GLOSSARY.opr.label} bonus is added after qualification matches.` : null,
    view.hasRankings && view.rpMethod === 'none' && !season ? `${GLOSSARY.rp.label} aren't available for this event.` : null,
  ].filter((n): n is string => n !== null);

  return (
    <>
      <StatusStrip
        tone={strip.tone}
        title={strip.title}
        detail={strip.detail}
        action={strip.action ? <Button href={strip.action.href} variant="accent" size="sm">{strip.action.label}</Button> : undefined}
        switcher={
          <EventSwitcher
            slug={slug}
            currentId={round.id}
            currentName={round.eventName}
            rounds={rounds}
            tbaUrl={round.eventKey ? tbaEventUrl(round.eventKey) : null}
          />
        }
      />
      {notes.length > 0 ? (
        <ul className="space-y-1 text-sm text-fg-muted">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      <Section label="Leaderboard" action={<ScoringSheet lines={scoringSummary(round.scoring)} />}>
        <PlayerBoard scores={view.scores} meId={meId} teamNames={view.teamNames} status={view.status} season={view.season} />
      </Section>
      {view.adjustments.length > 0 ? (
        <Section label={GLOSSARY.adjust.label}>
          <AdjustmentList adjustments={view.adjustments} playerNames={playerNames} teamNames={view.teamNames} />
        </Section>
      ) : null}
    </>
  );
}
