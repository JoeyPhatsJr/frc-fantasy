import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING, defaultScoring, type ScoringConfig } from '@/lib/scoring/config';
import { scoreEvent } from '@/lib/scoring/engine';
import { scoreManualEvent } from '@/lib/scoring/manual';
import { allianceLines, eventResultLines, playoffLines } from '@/lib/scoring/playoffs';
import { extractRp, qualRecords } from '@/lib/scoring/quals';
import type { AllianceRole, ManualResult } from '@/lib/scoring/types';
import { loadFixture } from '../helpers/fixture';

const data = loadFixture('2025parr');

const ROLE_BY_LABEL: Record<string, AllianceRole> = {
  'Alliance captain': 'captain',
  'Alliance first pick': 'pick1',
  'Alliance second pick': 'pick2',
  'Alliance third pick': 'pick3',
  'Backup robot': 'backup',
};

/** What a commissioner would type into the Results tab, read off Ramp Riot 2025's real TBA data. */
function typedResults(): ManualResult[] {
  const records = qualRecords(data.rankings, data.matches);
  const rp = extractRp(data.rankings).byTeam;
  const ranks = new Map(
    (data.rankings?.rankings ?? []).filter((r) => r.matches_played > 0).map((r) => [r.team_key, r.rank]),
  );
  const roles = allianceLines(data.alliances, DEFAULT_SCORING);
  const wins = playoffLines(data.matches, DEFAULT_SCORING);
  const finish = eventResultLines(data.alliances, data.matches, DEFAULT_SCORING);
  const awards = new Map<string, number[]>();
  for (const a of data.awards ?? []) {
    for (const r of a.recipient_list) {
      if (r.team_key) awards.set(r.team_key, [...(awards.get(r.team_key) ?? []), a.award_type]);
    }
  }
  return (data.teams ?? []).map((t) => {
    const rec = records.get(t.key) ?? { wins: 0, losses: 0, ties: 0 };
    const role = roles.get(t.key);
    const fin = finish.get(t.key);
    return {
      teamKey: t.key,
      qualWins: rec.wins,
      qualLosses: rec.losses,
      qualTies: rec.ties,
      rankingPoints: rp.get(t.key) ?? null,
      qualRank: ranks.get(t.key) ?? null,
      allianceRole: role ? ROLE_BY_LABEL[role.label] : null,
      playoffWins: wins.get(t.key)?.quantity ?? 0,
      eventResult: fin ? (fin.label === 'Event winner' ? 'winner' : 'finalist') : null,
      awardTypes: awards.get(t.key) ?? [],
    };
  });
}

/** A config where every category is worth a different, unusual amount, so a swapped field can't hide. */
const ODD: ScoringConfig = {
  ...defaultScoring(),
  qualWin: 7,
  qualTie: 3,
  qualLoss: -1,
  rankingPoint: 2,
  alliance: { captain: 11, pick1: 9, pick2: 5, pick3: 4, backup: 1 },
  playoffMatchWin: 6,
  eventWinner: 30,
  eventFinalist: 13,
};

describe.each([
  ['default scoring', DEFAULT_SCORING],
  ['unusual scoring', ODD],
])('manual results for 2025parr with %s', (_name, config) => {
  const tba = scoreEvent(data, config);
  const manual = scoreManualEvent(typedResults(), config);

  it('covers all 34 teams', () => {
    expect(manual.teams.size).toBe(34);
  });

  it('gives every team the TBA total minus its OPR line', () => {
    for (const [teamKey, score] of tba.teams) {
      const opr = score.lines.filter((l) => l.category === 'oprBonus').reduce((s, l) => s + l.points, 0);
      expect(manual.teams.get(teamKey)?.total ?? 0, teamKey).toBe(score.total - opr);
    }
  });

  it('produces the same lines (labels, quantities, order) apart from OPR', () => {
    for (const [teamKey, score] of tba.teams) {
      expect(manual.teams.get(teamKey)?.lines, teamKey).toEqual(score.lines.filter((l) => l.category !== 'oprBonus'));
    }
  });
});
