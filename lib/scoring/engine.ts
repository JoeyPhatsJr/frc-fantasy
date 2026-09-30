import { awardLines, oprLines } from '@/lib/scoring/bonus';
import type { ScoringConfig } from '@/lib/scoring/config';
import { qualsComplete } from '@/lib/scoring/matches';
import { allianceLines, allianceMembers, eventResultLines, playoffLines } from '@/lib/scoring/playoffs';
import { qualLines } from '@/lib/scoring/quals';
import type { EventScores, Line, TeamScore } from '@/lib/scoring/types';
import type { EventData } from '@/lib/tba/types';

/** Pure function: TBA data + config in, a score for every team out. No I/O, never throws on missing data. */
export function scoreEvent(data: EventData, config: ScoringConfig): EventScores {
  const done = qualsComplete(data.matches, data.alliances);

  const quals = qualLines({ rankings: data.rankings, matches: data.matches }, config, done);
  const alliance = allianceLines(data.alliances, config);
  const wins = playoffLines(data.matches, config);
  const result = eventResultLines(data.alliances, data.matches, config);
  const awards = awardLines(data.awards, config);
  const opr = oprLines(data.oprs, config, done);

  const keys = new Set<string>();
  for (const t of data.teams ?? []) keys.add(t.key);
  for (const r of data.rankings?.rankings ?? []) keys.add(r.team_key);
  for (const m of data.matches ?? []) {
    for (const side of ['red', 'blue'] as const) {
      for (const k of m.alliances?.[side]?.team_keys ?? []) keys.add(k);
    }
  }
  for (const a of data.alliances ?? []) for (const k of allianceMembers(a)) keys.add(k);
  for (const k of awards.keys()) keys.add(k);
  for (const k of opr.keys()) keys.add(k);

  const teams = new Map<string, TeamScore>();
  for (const teamKey of keys) {
    const lines: Line[] = [...(quals.lines.get(teamKey) ?? [])];
    const one = (line: Line | undefined) => {
      if (line) lines.push(line);
    };
    one(alliance.get(teamKey));
    one(wins.get(teamKey));
    one(result.get(teamKey));
    lines.push(...(awards.get(teamKey) ?? []));
    one(opr.get(teamKey));
    teams.set(teamKey, { teamKey, total: lines.reduce((sum, l) => sum + l.points, 0), lines });
  }

  return { teams, qualsComplete: done, rpMethod: quals.rpMethod };
}
