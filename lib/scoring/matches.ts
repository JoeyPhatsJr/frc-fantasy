import type { Alliance, MatchSimple } from '@/lib/tba/types';

export type Side = 'red' | 'blue';

function scores(m: MatchSimple): { red: number; blue: number } | null {
  const red = m.alliances?.red?.score;
  const blue = m.alliances?.blue?.score;
  if (typeof red !== 'number' || typeof blue !== 'number') return null;
  if (red < 0 || blue < 0) return null; // TBA uses -1 for unplayed
  return { red, blue };
}

export function hasResult(m: MatchSimple): boolean {
  return scores(m) !== null;
}

/**
 * Who won. Trusts TBA's winning_alliance whenever it is present, because TBA
 * applies game tiebreakers we can't see. '' means "no winner" and is final.
 * Scores are only compared when the field is missing altogether (§7.5).
 */
export function winnerOf(m: MatchSimple): Side | null {
  const s = scores(m);
  if (!s) return null;
  const w = m.winning_alliance;
  if (w === 'red' || w === 'blue') return w;
  if (w === '') return null;
  if (s.red > s.blue) return 'red';
  if (s.blue > s.red) return 'blue';
  return null;
}

/** Teams on a side that get credit for the match: not surrogates, not disqualified. */
export function creditedTeams(m: MatchSimple, side: Side): string[] {
  const a = m.alliances?.[side];
  if (!a) return [];
  const excluded = new Set([...(a.surrogate_team_keys ?? []), ...(a.dq_team_keys ?? [])]);
  return (a.team_keys ?? []).filter((k) => !excluded.has(k));
}

export function qualsComplete(matches: MatchSimple[] | null, alliances: Alliance[] | null): boolean {
  if ((alliances ?? []).some((a) => (a.picks ?? []).length > 0)) return true;
  const all = matches ?? [];
  const quals = all.filter((m) => m.comp_level === 'qm');
  const hasPlayoff = all.some((m) => m.comp_level !== 'qm');
  return quals.length > 0 && quals.every(hasResult) && hasPlayoff;
}
