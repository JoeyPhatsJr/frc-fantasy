import { getRepo } from '@/lib/db';
import type { RoundRow } from '@/lib/db/types';
import { cacheWindowFor } from '@/lib/rounds/status';
import { getTba } from '@/lib/tba/client';
import type { TeamSimple } from '@/lib/tba/types';
import { mergePool, type PoolTeam } from '@/lib/teams';

/** The draftable teams for a round: TBA's list plus the commissioner's manual additions (spec §3.3). */
export async function loadPool(
  round: RoundRow,
  now: Date,
): Promise<{ teams: PoolTeam[]; stale: boolean; tbaCount: number }> {
  // Temporary guard: only TBA rounds have a team list to fetch (Task 5 replaces this function).
  const eventKey = round.kind === 'tba' ? round.eventKey : null;
  const [tba, extras] = await Promise.all([
    eventKey
      ? getTba<TeamSimple[]>(`/event/${eventKey}/teams/simple`, { windowMs: cacheWindowFor(round, now) })
      : Promise.resolve({ data: null, fetchedAt: null, stale: false }),
    getRepo().listExtraTeams(round.id),
  ]);
  const tbaTeams = Array.isArray(tba.data) ? tba.data : null;
  return { teams: mergePool(tbaTeams, extras), stale: tba.stale, tbaCount: tbaTeams?.length ?? 0 };
}
