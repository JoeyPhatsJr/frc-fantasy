import { awardName } from '@/lib/scoring/awardTypes';
import { awardLines } from '@/lib/scoring/bonus';
import type { ScoringConfig } from '@/lib/scoring/config';
import { rankTierPoints } from '@/lib/scoring/quals';
import type { AllianceRole, EventScores, Line, ManualResult, TeamScore } from '@/lib/scoring/types';
import type { Award } from '@/lib/tba/types';

/** Must match the labels in lib/scoring/playoffs.ts allianceLines(), so both kinds of round read the same. */
export const ALLIANCE_ROLE_LABEL: Record<AllianceRole, string> = {
  captain: 'Alliance captain',
  pick1: 'Alliance first pick',
  pick2: 'Alliance second pick',
  pick3: 'Alliance third pick',
  backup: 'Backup robot',
};

/**
 * Pure: typed-in final results + config → the same EventScores shape as scoreEvent (spec §5.3).
 * Same categories and labels, in the same order; never an OPR bonus (there is no OPR without TBA).
 */
export function scoreManualEvent(results: ManualResult[], config: ScoringConfig): EventScores {
  const teams = new Map<string, TeamScore>();
  for (const r of results) {
    const lines: Line[] = [
      {
        category: 'qualRecord',
        label: `Qual record ${r.qualWins}-${r.qualLosses}-${r.qualTies}`,
        points: r.qualWins * config.qualWin + r.qualTies * config.qualTie + r.qualLosses * config.qualLoss,
      },
    ];
    if (r.rankingPoints !== null) {
      lines.push({
        category: 'rankingPoints',
        label: `Ranking points ${r.rankingPoints}`,
        quantity: r.rankingPoints,
        points: r.rankingPoints * config.rankingPoint,
      });
    }
    if (r.qualRank !== null) {
      // A typed-in rank is a final rank: results are entered once quals are over.
      lines.push({
        category: 'rank',
        label: `Final rank #${r.qualRank}`,
        quantity: r.qualRank,
        points: rankTierPoints(r.qualRank, config.rankTiers),
      });
    }
    if (r.allianceRole) {
      lines.push({ category: 'alliance', label: ALLIANCE_ROLE_LABEL[r.allianceRole], points: config.alliance[r.allianceRole] });
    }
    if (r.playoffWins > 0) {
      lines.push({
        category: 'playoffWins',
        label: `Playoff wins ×${r.playoffWins}`,
        quantity: r.playoffWins,
        points: r.playoffWins * config.playoffMatchWin,
      });
    }
    if (r.eventResult === 'winner') lines.push({ category: 'eventResult', label: 'Event winner', points: config.eventWinner });
    if (r.eventResult === 'finalist') {
      lines.push({ category: 'eventResult', label: 'Event finalist', points: config.eventFinalist });
    }
    // Reuse the TBA award rules (excluded types, byType, default) by describing each award like TBA would.
    const awards: Award[] = r.awardTypes.map((type) => ({
      name: awardName(type),
      award_type: type,
      recipient_list: [{ team_key: r.teamKey, awardee: null }],
    }));
    lines.push(...(awardLines(awards, config).get(r.teamKey) ?? []));

    teams.set(r.teamKey, { teamKey: r.teamKey, total: lines.reduce((sum, l) => sum + l.points, 0), lines });
  }
  return { teams, qualsComplete: results.length > 0, rpMethod: 'manual' };
}
