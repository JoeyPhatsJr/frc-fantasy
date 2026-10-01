import { getRepo } from '@/lib/db';
import type { RoundRow } from '@/lib/db/types';
import { cacheWindowFor } from '@/lib/rounds/status';
import { loadSeasonTbaTeams, seasonEmptyMessage } from '@/lib/season/pool';
import { DEFAULT_POOL_FILTER } from '@/lib/season/poolFilter';
import { getTba } from '@/lib/tba/client';
import type { TeamSimple } from '@/lib/tba/types';
import { mergePool, type PoolTeam } from '@/lib/teams';

export type LoadedPool = {
  teams: PoolTeam[];
  stale: boolean;
  tbaCount: number;
  /** Why the pool is empty when that isn't the commissioner's doing (season rounds, spec §5.5); else null. */
  emptyMessage: string | null;
};

/** The draftable teams for a round: TBA's list plus the commissioner's manual additions (spec §3.3). */
export async function loadPool(round: RoundRow, now: Date): Promise<LoadedPool> {
  if (round.kind === 'season' && round.seasonYear !== null) {
    const [tba, extras] = await Promise.all([
      loadSeasonTbaTeams(round.seasonYear, round.poolFilter ?? DEFAULT_POOL_FILTER),
      getRepo().listExtraTeams(round.id),
    ]);
    const teams = mergePool(tba.teams, extras);
    return {
      teams,
      stale: tba.stale,
      tbaCount: tba.teams.length,
      // Only blame TBA's calendar when TBA actually answered with nothing at all.
      emptyMessage: teams.length === 0 && !tba.stale && !tba.published ? seasonEmptyMessage(round.seasonYear) : null,
    };
  }
  if (round.kind === 'manual' || !round.eventKey) {
    // Manual events aren't on TBA: the pool is only what the commissioner typed in (spec §5.3).
    const extras = await getRepo().listExtraTeams(round.id);
    return { teams: mergePool(null, extras), stale: false, tbaCount: 0, emptyMessage: null };
  }
  const [tba, extras] = await Promise.all([
    getTba<TeamSimple[]>(`/event/${round.eventKey}/teams/simple`, { windowMs: cacheWindowFor(round, now) }),
    getRepo().listExtraTeams(round.id),
  ]);
  const tbaTeams = Array.isArray(tba.data) ? tba.data : null;
  return {
    teams: mergePool(tbaTeams, extras),
    stale: tba.stale,
    tbaCount: tbaTeams?.length ?? 0,
    emptyMessage: null,
  };
}
