import type { ScoringConfig } from '@/lib/scoring/config';
import { creditedTeams, hasResult, winnerOf } from '@/lib/scoring/matches';
import type { Line } from '@/lib/scoring/types';
import type { Alliance, MatchSimple } from '@/lib/tba/types';

export function allianceMembers(a: Alliance): string[] {
  const members = [...(a.picks ?? [])];
  const backup = a.backup?.in;
  if (backup && !members.includes(backup)) members.push(backup);
  return members;
}

export function allianceLines(alliances: Alliance[] | null, config: ScoringConfig): Map<string, Line> {
  const positions: { label: string; points: number }[] = [
    { label: 'Alliance captain', points: config.alliance.captain },
    { label: 'Alliance first pick', points: config.alliance.pick1 },
    { label: 'Alliance second pick', points: config.alliance.pick2 },
    { label: 'Alliance third pick', points: config.alliance.pick3 },
  ];
  const out = new Map<string, Line>();
  // A team should only ever appear once. If the data is inconsistent, keep its best position.
  const offer = (team: string, label: string, points: number) => {
    const existing = out.get(team);
    if (!existing || points > existing.points) out.set(team, { category: 'alliance', label, points });
  };
  for (const a of alliances ?? []) {
    (a.picks ?? []).slice(0, positions.length).forEach((team, i) => {
      offer(team, positions[i].label, positions[i].points);
    });
  }
  for (const a of alliances ?? []) {
    if (a.backup?.in) offer(a.backup.in, 'Backup robot', config.alliance.backup);
  }
  return out;
}

export function playoffLines(matches: MatchSimple[] | null, config: ScoringConfig): Map<string, Line> {
  const wins = new Map<string, number>();
  for (const m of matches ?? []) {
    if (m.comp_level === 'qm' || !hasResult(m)) continue;
    const winner = winnerOf(m);
    if (!winner) continue;
    for (const team of creditedTeams(m, winner)) wins.set(team, (wins.get(team) ?? 0) + 1);
  }
  const out = new Map<string, Line>();
  for (const [team, n] of wins) {
    out.set(team, {
      category: 'playoffWins',
      label: `Playoff wins ×${n}`,
      quantity: n,
      points: n * config.playoffMatchWin,
    });
  }
  return out;
}

type Finals = { winner: number | null; finalist: number | null };

function fromStatus(alliances: Alliance[]): Finals {
  let winner: number | null = null;
  let finalist: number | null = null;
  alliances.forEach((a, i) => {
    if (a.status?.level !== 'f') return;
    if (a.status.status === 'won' && winner === null) winner = i;
    if (a.status.status === 'eliminated' && finalist === null) finalist = i;
  });
  return { winner, finalist };
}

/** Which alliance is this side of a match? Needs at least 2 teams in common. */
function allianceForSide(teamKeys: string[], alliances: Alliance[]): number | null {
  let best: number | null = null;
  let bestOverlap = 1;
  alliances.forEach((a, i) => {
    const members = new Set(allianceMembers(a));
    const overlap = teamKeys.filter((k) => members.has(k)).length;
    if (overlap > bestOverlap) {
      best = i;
      bestOverlap = overlap;
    }
  });
  return best;
}

function fromFinalsMatches(alliances: Alliance[], matches: MatchSimple[]): Finals {
  const finals = matches
    .filter((m) => m.comp_level === 'f' && hasResult(m))
    .sort((a, b) => a.set_number - b.set_number || a.match_number - b.match_number);

  const wins = new Map<number, number>();
  const appeared: number[] = [];
  let winner: number | null = null;

  for (const m of finals) {
    const sides = {
      red: allianceForSide(m.alliances?.red?.team_keys ?? [], alliances),
      blue: allianceForSide(m.alliances?.blue?.team_keys ?? [], alliances),
    };
    for (const idx of [sides.red, sides.blue]) {
      if (idx !== null && !appeared.includes(idx)) appeared.push(idx);
    }
    const w = winnerOf(m);
    const idx = w ? sides[w] : null;
    if (idx === null) continue;
    const total = (wins.get(idx) ?? 0) + 1;
    wins.set(idx, total);
    if (total >= 2 && winner === null) winner = idx;
  }

  if (winner === null) return { winner: null, finalist: null };
  const finalist = appeared.find((i) => i !== winner) ?? null;
  return { winner, finalist };
}

export function finalsResult(alliances: Alliance[] | null, matches: MatchSimple[] | null): Finals {
  const list = alliances ?? [];
  const primary = fromStatus(list);
  if (primary.winner !== null && primary.finalist !== null) return primary;

  const fallback = fromFinalsMatches(list, matches ?? []);
  const winner = primary.winner ?? fallback.winner;
  let finalist = primary.finalist ?? fallback.finalist;
  if (finalist === winner) finalist = null;
  return { winner, finalist };
}

export function eventResultLines(
  alliances: Alliance[] | null,
  matches: MatchSimple[] | null,
  config: ScoringConfig,
): Map<string, Line> {
  const out = new Map<string, Line>();
  const list = alliances ?? [];
  const { winner, finalist } = finalsResult(list, matches);
  if (finalist !== null) {
    for (const team of allianceMembers(list[finalist])) {
      out.set(team, { category: 'eventResult', label: 'Event finalist', points: config.eventFinalist });
    }
  }
  if (winner !== null) {
    for (const team of allianceMembers(list[winner])) {
      out.set(team, { category: 'eventResult', label: 'Event winner', points: config.eventWinner });
    }
  }
  return out;
}
