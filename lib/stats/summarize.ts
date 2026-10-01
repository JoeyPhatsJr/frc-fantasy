import type { BestFinish, TeamStatsAward } from '@/lib/db/types';
import { DEFAULT_SCORING } from '@/lib/scoring/config';
import { hasResult } from '@/lib/scoring/matches';
import { allianceMembers, finalsResult } from '@/lib/scoring/playoffs';
import { qualRecords } from '@/lib/scoring/quals';
import type { EventScores } from '@/lib/scoring/types';
import type { EventData, TbaEvent } from '@/lib/tba/types';

/** One team at one event: the facts team_stats is built from. */
export type TeamEventSummary = {
  teamKey: string;
  eventKey: string;
  name: string;
  endDate: string;
  playedQuals: number;
  wins: number;
  losses: number;
  ties: number;
  rank: number | null;
  finish: BestFinish | null;
  /** Fantasy points under DEFAULT_SCORING. */
  points: number;
  opr: number | null;
  awards: TeamStatsAward[];
};

export const FINISH_ORDER: BestFinish[] = ['winner', 'finalist', 'captain', 'picked'];

export function betterFinish(a: BestFinish | null, b: BestFinish | null): BestFinish | null {
  if (a === null) return b;
  if (b === null) return a;
  return FINISH_ORDER.indexOf(a) <= FINISH_ORDER.indexOf(b) ? a : b;
}

/**
 * Per-team facts for one event (spec §6.1). Only teams with at least one PLAYED qual match are
 * returned, so Einstein (no quals) and events that haven't started are never counted.
 * Expects cleaned data (cleanEventData) and scores computed with DEFAULT_SCORING.
 */
export function summarizeEvent(event: TbaEvent, data: EventData, scores: EventScores): TeamEventSummary[] {
  const played = new Map<string, number>();
  for (const m of data.matches ?? []) {
    if (m.comp_level !== 'qm' || !hasResult(m)) continue;
    for (const side of ['red', 'blue'] as const) {
      for (const k of m.alliances?.[side]?.team_keys ?? []) played.set(k, (played.get(k) ?? 0) + 1);
    }
  }

  const records = qualRecords(data.rankings, data.matches);

  const ranks = new Map<string, number>();
  for (const row of data.rankings?.rankings ?? []) {
    if (row.matches_played > 0 && typeof row.rank === 'number' && row.rank > 0) ranks.set(row.team_key, row.rank);
  }

  const finals = finalsResult(data.alliances, data.matches);
  const finish = new Map<string, BestFinish>();
  (data.alliances ?? []).forEach((a, index) => {
    allianceMembers(a).forEach((teamKey, position) => {
      let f: BestFinish = position === 0 ? 'captain' : 'picked';
      if (index === finals.winner) f = 'winner';
      else if (index === finals.finalist) f = 'finalist';
      finish.set(teamKey, betterFinish(finish.get(teamKey) ?? null, f) ?? f);
    });
  });

  const excluded = new Set(DEFAULT_SCORING.awards.excludedTypes);
  const awards = new Map<string, TeamStatsAward[]>();
  for (const award of data.awards ?? []) {
    if (excluded.has(award.award_type)) continue;
    for (const r of award.recipient_list ?? []) {
      if (!r.team_key) continue;
      const list = awards.get(r.team_key) ?? [];
      list.push({ type: award.award_type, name: award.name, eventKey: event.key });
      awards.set(r.team_key, list);
    }
  }

  const oprs = data.oprs?.oprs ?? {};
  return [...played.entries()]
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([teamKey, playedQuals]) => {
      const rec = records.get(teamKey) ?? { wins: 0, losses: 0, ties: 0 };
      const opr = oprs[teamKey];
      return {
        teamKey,
        eventKey: event.key,
        name: event.name,
        endDate: event.end_date,
        playedQuals,
        wins: rec.wins,
        losses: rec.losses,
        ties: rec.ties,
        rank: ranks.get(teamKey) ?? null,
        finish: finish.get(teamKey) ?? null,
        points: scores.teams.get(teamKey)?.total ?? 0,
        opr: typeof opr === 'number' && Number.isFinite(opr) ? opr : null,
        awards: awards.get(teamKey) ?? [],
      };
    });
}
