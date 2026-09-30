import { pickerFor } from '@/lib/scoring/round';
import type { PoolTeam } from '@/lib/teams';

export function draftBanner(args: {
  pickCount: number;
  draftOrder: string[];
  rosterSize: number;
  playerNames: Record<string, string>;
}): string {
  const { pickCount, draftOrder, rosterSize, playerNames } = args;
  const P = draftOrder.length;
  if (P === 0) return 'Set the draft order to start the draft';
  const total = P * rosterSize;
  if (pickCount >= total) return `Draft complete — ${total} of ${total} picks`;
  const picker = playerNames[pickerFor(pickCount, draftOrder)] ?? 'Unknown';
  const draftRound = Math.floor(pickCount / P) + 1;
  return `Pick ${pickCount + 1} of ${total} — ${picker}'s turn (round ${draftRound})`;
}

/** Teams still on the board, filtered by number prefix or nickname substring. */
export function availableTeams(pool: PoolTeam[], picks: { teamKey: string }[], query: string): PoolTeam[] {
  const taken = new Set(picks.map((p) => p.teamKey));
  const q = query.trim().toLowerCase();
  return pool.filter(
    (t) =>
      !taken.has(t.teamKey) &&
      (q === '' || t.label.toLowerCase().startsWith(q) || (t.nickname ?? '').toLowerCase().includes(q)),
  );
}

export function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return [...list];
  const out = [...list];
  [out[index], out[target]] = [out[target], out[index]];
  return out;
}

/** Fisher-Yates shuffle. `random` is injectable so tests are repeatable. */
export function shuffled<T>(list: T[], random: () => number = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
