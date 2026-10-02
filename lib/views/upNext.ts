import type { DraftPhase } from '@/lib/draft/live';
import { shortDate } from '@/lib/format';
import { addDays, type RoundStatus } from '@/lib/rounds/status';

export type UpNextInput = {
  leagueSlug: string; leagueName: string;
  roundId: string; eventName: string; startDate: string; endDate: string;
  status: RoundStatus; draftMode: 'live' | 'commissioner'; draftPhase: DraftPhase; myTurn: boolean;
  myRank: number | null; myPoints: number | null; winnerName: string | null; myTeams: string[];
};
export type UpNextKind = 'draft-live' | 'event-live' | 'results' | 'event-soon' | 'draft-soon';
export type UpNext = { kind: UpNextKind; item: UpNextInput } | null;

const byStartThenLeague = (a: UpNextInput, b: UpNextInput) =>
  a.startDate.localeCompare(b.startDate) || a.leagueName.localeCompare(b.leagueName);

/** The single most useful thing to show on Home, across all the user's leagues (spec §8.1). */
export function upNext(items: UpNextInput[], today: string): UpNext {
  const first = (kind: UpNextKind, list: UpNextInput[], order = byStartThenLeague): UpNext =>
    list.length > 0 ? { kind, item: [...list].sort(order)[0] } : null;

  const drafting = items.filter((i) => i.draftPhase === 'live' || i.draftPhase === 'paused');
  if (drafting.length > 0) {
    return first('draft-live', drafting, (a, b) => Number(b.myTurn) - Number(a.myTurn) || byStartThenLeague(a, b));
  }
  const live = first('event-live', items.filter((i) => i.status === 'live'));
  if (live) return live;
  const results = first(
    'results',
    items.filter((i) => (i.status === 'final' || i.status === 'awaiting_final') && today <= addDays(i.endDate, 3)),
    (a, b) => b.endDate.localeCompare(a.endDate) || a.leagueName.localeCompare(b.leagueName),
  );
  if (results) return results;
  const soon = first('event-soon', items.filter((i) => i.status === 'upcoming'));
  if (soon) return soon;
  return first('draft-soon', items.filter((i) => (i.status === 'setup' || i.status === 'drafting') && i.endDate >= today));
}

const PHRASE: Record<RoundStatus, (startDate: string) => string> = {
  setup: () => 'draft not set up',
  drafting: () => 'drafting',
  upcoming: (d) => `starts ${shortDate(d)}`,
  live: () => 'live now',
  awaiting_final: () => 'event over',
  final: () => 'final',
};

/** "Ramp Riot · drafting" — the one-line status under a league's name (spec §6.1). */
export function leagueStatusLine(view: { eventName: string; status: RoundStatus; startDate: string } | null): string {
  if (!view) return 'No events yet';
  return `${view.eventName} · ${PHRASE[view.status](view.startDate)}`;
}
