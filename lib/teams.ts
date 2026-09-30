export const TEAM_KEY_RE = /^frc[1-9][0-9]{0,4}[A-Z]?$/;
export const EVENT_KEY_RE = /^[0-9]{4}[a-z0-9]+$/;

export function isTeamKey(s: string): boolean {
  return TEAM_KEY_RE.test(s);
}

/** Turns what a human typed ("341", " 341b ", "frc341") into a team key, or null. */
export function parseTeamInput(input: string): string | null {
  const m = /^(?:frc)?0*([1-9][0-9]{0,4})([a-z]?)$/i.exec(input.trim());
  if (!m) return null;
  return `frc${m[1]}${m[2].toUpperCase()}`;
}

export function normalizeEventKey(input: string): string | null {
  const key = input.trim().toLowerCase();
  return EVENT_KEY_RE.test(key) ? key : null;
}

export function teamLabel(teamKey: string): string {
  return teamKey.replace(/^frc/, '');
}

export type PoolTeam = {
  teamKey: string;
  label: string;
  nickname: string | null;
  manual: boolean;
};

function sortParts(teamKey: string): [number, string] {
  const m = /^frc([0-9]+)([A-Z]?)$/.exec(teamKey);
  return m ? [Number(m[1]), m[2]] : [Number.MAX_SAFE_INTEGER, teamKey];
}

export function mergePool(
  tbaTeams: { key: string; nickname?: string | null }[] | null,
  extraKeys: string[],
): PoolTeam[] {
  const byKey = new Map<string, PoolTeam>();
  for (const t of tbaTeams ?? []) {
    if (!isTeamKey(t.key)) continue;
    byKey.set(t.key, { teamKey: t.key, label: teamLabel(t.key), nickname: t.nickname ?? null, manual: false });
  }
  for (const key of extraKeys) {
    if (!isTeamKey(key) || byKey.has(key)) continue;
    byKey.set(key, { teamKey: key, label: teamLabel(key), nickname: null, manual: true });
  }
  return [...byKey.values()].sort((a, b) => {
    const [an, as] = sortParts(a.teamKey);
    const [bn, bs] = sortParts(b.teamKey);
    return an - bn || as.localeCompare(bs);
  });
}
