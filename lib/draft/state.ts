import { getRepo } from '@/lib/db';
import type { DraftMode, PickSeconds, PlayerRow, RoundRow } from '@/lib/db/types';
import { draftPhase, onClockPlayer, totalPicks, type DraftPhase } from '@/lib/draft/live';

export type DraftState = {
  phase: DraftPhase;
  draftMode: DraftMode;
  /** The next pick's 0-based number (= picks made so far). */
  pickNumber: number;
  totalPicks: number;
  onClock: { playerId: string; name: string } | null;
  deadline: string | null;
  serverNow: string;
  pickSeconds: PickSeconds | null;
  /** Time left when paused (null = full timer on resume, or no timer). */
  pausedRemainingMs: number | null;
  order: { playerId: string; name: string }[];
  rosterSize: number;
  picks: { pickNumber: number; playerId: string; teamKey: string; auto: boolean }[];
  autodraftPlayerIds: string[];
  me?: { playerId: string; isCommissioner: boolean; queue: string[]; autodraft: boolean };
};

/** Everything a phone needs to draw the draft room (spec §7.3). `viewer` is null for non-members. */
export async function loadDraftState(round: RoundRow, viewer: PlayerRow | null, now: Date): Promise<DraftState> {
  const repo = getRepo();
  const [players, picks, autos] = await Promise.all([
    repo.listPlayers(round.leagueId),
    repo.listPicks(round.id),
    repo.listAutodraftPlayers(round.id),
  ]);
  const names = new Map(players.map((p) => [p.id, p.name]));
  const nameOf = (id: string) => names.get(id) ?? 'Unknown';
  const onClockId = onClockPlayer(round, picks.length);
  const phase = draftPhase(round, picks.length);

  const state: DraftState = {
    phase,
    draftMode: round.draftMode,
    pickNumber: picks.length,
    totalPicks: totalPicks(round),
    onClock: onClockId && phase !== 'setup' ? { playerId: onClockId, name: nameOf(onClockId) } : null,
    deadline: phase === 'live' ? round.pickDeadline : null,
    serverNow: now.toISOString(),
    pickSeconds: round.pickSeconds,
    pausedRemainingMs:
      phase !== 'paused'
        ? null
        : (round.pausedRemainingMs ?? (round.pickSeconds === null ? null : round.pickSeconds * 1000)),
    order: round.draftOrder.map((id) => ({ playerId: id, name: nameOf(id) })),
    rosterSize: round.rosterSize,
    picks: picks.map((p) => ({ pickNumber: p.pickNumber, playerId: p.playerId, teamKey: p.teamKey, auto: p.auto })),
    autodraftPlayerIds: autos,
  };
  if (viewer) {
    const [queue, autodraft] = await Promise.all([
      repo.getQueue(round.id, viewer.id),
      repo.getAutodraft(round.id, viewer.id),
    ]);
    state.me = { playerId: viewer.id, isCommissioner: viewer.role === 'commissioner', queue, autodraft };
  }
  return state;
}
