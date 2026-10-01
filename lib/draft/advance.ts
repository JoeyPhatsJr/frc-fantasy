import { getRepo } from '@/lib/db';
import { chooseAutoPick, draftPhase, onClockPlayer } from '@/lib/draft/live';
import { buildPoolEntries } from '@/lib/pool/entries';

/**
 * Spec §7.4: while the draft is live and the on-clock player has auto-draft on, pick for them.
 * Run after start, every pick, resume, undo, and auto-draft turned on. Returns the picks made.
 * Stops quietly if another request changes the draft (pause, pick, undo); that request runs advance too.
 * Bounded: each pass makes one pick, so it can never run past the picks remaining.
 */
export async function advance(roundId: string, now: Date): Promise<number> {
  const repo = getRepo();
  const round = await repo.getRound(roundId);
  if (!round || round.draftMode !== 'live') return 0;
  const [picks, autos] = await Promise.all([repo.listPicks(roundId), repo.listAutodraftPlayers(roundId)]);
  const onAuto = new Set(autos);
  let n = picks.length;
  if (draftPhase(round, n) !== 'live' || !onAuto.has(onClockPlayer(round, n) ?? '')) return 0;

  const pool = await buildPoolEntries(round, now);
  const taken = new Set(picks.map((p) => p.teamKey));
  let made = 0;
  for (;;) {
    const playerId = onClockPlayer(round, n);
    if (!playerId || !onAuto.has(playerId)) break;
    const available = pool.filter((e) => !taken.has(e.teamKey));
    const teamKey = chooseAutoPick(await repo.getQueue(roundId, playerId), available);
    if (!teamKey) break;
    const ok = await repo.makePickAtomic({
      roundId, pickNumber: n, playerId, teamKey, requireDue: false, auto: true,
    });
    if (!ok) break;
    taken.add(teamKey);
    n += 1;
    made += 1;
  }
  return made;
}
