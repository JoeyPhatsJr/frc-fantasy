import type { DailyJob } from '@/lib/cron/jobs';
import { getRepo } from '@/lib/db';
import type { Repo } from '@/lib/db/repo';
import type { RoundRow } from '@/lib/db/types';
import { autoFinalDecision, draftComplete } from '@/lib/rounds/autoFinal';
import { cacheWindowFor } from '@/lib/rounds/status';
import { finalsResult } from '@/lib/scoring/playoffs';
import { getTba } from '@/lib/tba/client';
import { eventPaths } from '@/lib/tba/event';
import type { Alliance, MatchSimple } from '@/lib/tba/types';

export type AutoFinalizeSummary = {
  finalized: string[];
  waitingOnFinals: string[];
  errors: { roundId: string; message: string }[];
};

/** True when the cached TBA data shows who won the event's finals (the same rule that awards winner points). */
async function finalsDecided(round: RoundRow, now: Date): Promise<boolean> {
  if (!round.eventKey) return false;
  const paths = eventPaths(round.eventKey);
  const windowMs = cacheWindowFor(round, now);
  const [alliances, matches] = await Promise.all([
    getTba<Alliance[]>(paths.alliances, { windowMs }),
    getTba<MatchSimple[]>(paths.matches, { windowMs }),
  ]);
  const list = Array.isArray(alliances.data) ? alliances.data : null;
  const games = Array.isArray(matches.data) ? matches.data : null;
  return finalsResult(list, games).winner !== null;
}

/** Spec 2026-10-02 §5: finalize every round whose event is over, one round at a time, within the budget. */
export async function autoFinalizeRounds(
  repo: Repo,
  now: Date,
  deadline: number,
  clock: () => number = Date.now,
): Promise<AutoFinalizeSummary> {
  const summary: AutoFinalizeSummary = { finalized: [], waitingOnFinals: [], errors: [] };
  const rounds = await repo.listAutoFinalizeCandidates();
  if (rounds.length === 0) return summary;
  const picks = await repo.listPicksForRounds(rounds.map((r) => r.id));

  for (const round of rounds) {
    if (clock() >= deadline) break;
    try {
      const count = picks.filter((p) => p.roundId === round.id).length;
      const decision = autoFinalDecision(
        {
          kind: round.kind,
          endDate: round.endDate,
          timezone: round.timezone,
          finalizedAt: round.finalizedAt,
          autoFinalize: round.autoFinalize,
          draftComplete: draftComplete(round, count),
        },
        now,
      );
      if (decision === 'wait') continue;
      if (decision === 'needs-finals-check' && !(await finalsDecided(round, now))) {
        summary.waitingOnFinals.push(round.id);
        continue;
      }
      await repo.updateRound(round.id, { finalizedAt: now.toISOString() });
      summary.finalized.push(round.id);
    } catch (err) {
      console.error(`auto-finalize: round ${round.id} failed`, err);
      summary.errors.push({ roundId: round.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return summary;
}

export const autoFinalizeJob: DailyJob = {
  name: 'auto-finalize',
  async run(now, deadline) {
    const s = await autoFinalizeRounds(getRepo(), now, deadline);
    console.log(
      `auto-finalize: ${s.finalized.length} finalized, ${s.waitingOnFinals.length} waiting on finals, ${s.errors.length} errors`,
    );
  },
};
