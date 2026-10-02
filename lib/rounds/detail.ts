import type { AdminRoundDetail } from '@/lib/api/types';
import { getRepo } from '@/lib/db';
import type { RoundRow } from '@/lib/db/types';
import { draftPhase } from '@/lib/draft/live';
import { loadPool } from '@/lib/rounds/pool';
import { roundStatus, shouldNudgeFinalize } from '@/lib/rounds/status';
import { MAX_SEASON_ROSTER } from '@/lib/season/calendar';

/** Everything the round admin page needs, in one response. */
export async function roundDetail(round: RoundRow, now: Date): Promise<AdminRoundDetail> {
  const repo = getRepo();
  const [players, picks, adjustments, pool, manualRows] = await Promise.all([
    repo.listPlayers(round.leagueId),
    repo.listPicks(round.id),
    repo.listAdjustments(round.id),
    loadPool(round, now),
    round.kind === 'manual' ? repo.listManualResults(round.id) : Promise.resolve(null),
  ]);
  const drafters = round.draftOrder.length;
  return {
    round: {
      id: round.id,
      eventKey: round.eventKey,
      kind: round.kind,
      seasonYear: round.seasonYear,
      poolFilter: round.poolFilter,
      eventName: round.eventName,
      startDate: round.startDate,
      endDate: round.endDate,
      timezone: round.timezone,
      rosterSize: round.rosterSize,
      draftOrder: round.draftOrder,
      scoring: round.scoring,
      finalizedAt: round.finalizedAt,
      autoFinalize: round.autoFinalize,
      draftMode: round.draftMode,
      pickSeconds: round.pickSeconds,
      draftStartedAt: round.draftStartedAt,
      draftPausedAt: round.draftPausedAt,
    },
    draftPhase: draftPhase(round, picks.length),
    status: roundStatus(round, picks.length, now),
    nudgeFinalize: shouldNudgeFinalize(round, now),
    players: players.map((p) => ({ id: p.id, name: p.name })),
    pool: pool.teams,
    poolStale: pool.stale,
    picks: picks.map((p) => ({ pickNumber: p.pickNumber, playerId: p.playerId, teamKey: p.teamKey })),
    adjustments: adjustments.map((a) => ({
      id: a.id,
      playerId: a.playerId,
      teamKey: a.teamKey,
      points: a.points,
      reason: a.reason,
    })),
    poolEmptyMessage: pool.emptyMessage,
    maxRosterSize:
      drafters === 0
        ? null
        : Math.min(round.kind === 'season' ? MAX_SEASON_ROSTER : 10, Math.floor(pool.teams.length / drafters)),
    manualResults: manualRows ? manualRows.map(({ roundId: _roundId, ...r }) => r) : null,
  };
}
