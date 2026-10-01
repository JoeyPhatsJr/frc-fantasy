export const MAX_FOLLOWS = 3;

/** "5181, 341" → [5181, 341]. Accepts commas or spaces and an optional "frc" prefix. */
export function parseFollowInput(text: string): { teams: number[] } | { error: string } {
  const teams: number[] = [];
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    const m = /^(?:frc)?0*([1-9][0-9]{0,4})$/i.exec(token);
    if (!m) return { error: `"${token}" isn't a team number` };
    const n = Number(m[1]);
    if (!teams.includes(n)) teams.push(n);
  }
  if (teams.length > MAX_FOLLOWS) return { error: `Follow at most ${MAX_FOLLOWS} teams` };
  return { teams };
}

export function autoAddedNote(follows: number[]): string {
  return follows.length === 0 ? 'Auto-added' : `Auto-added · following ${follows.join(', ')}`;
}
