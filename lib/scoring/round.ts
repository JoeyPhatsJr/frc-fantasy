import type {
  Adjustment,
  Line,
  Pick,
  Player,
  PlayerRoundScore,
  SeasonRow,
  TeamScore,
} from '@/lib/scoring/types';

/** Snake draft: 1-2-3, 3-2-1, 1-2-3, ... (§3.2). pickNumber is 0-indexed. */
export function pickerFor(pickNumber: number, order: string[]): string {
  const P = order.length;
  if (P === 0) throw new Error('Draft order is empty');
  if (!Number.isInteger(pickNumber) || pickNumber < 0) {
    throw new Error('Pick number must be a whole number, 0 or more');
  }
  const draftRound = Math.floor(pickNumber / P);
  const slot = pickNumber % P;
  return draftRound % 2 === 0 ? order[slot] : order[P - 1 - slot];
}

export function rankByTotal<T extends { name: string; total: number }>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
  );
  let rank = 0;
  return sorted.map((row, i) => {
    if (i === 0 || row.total !== sorted[i - 1].total) rank = i + 1;
    return { ...row, rank };
  });
}

export function roundPlayers(allPlayers: Player[], draftOrder: string[], adjustments: Adjustment[]): Player[] {
  const byId = new Map(allPlayers.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: Player[] = [];
  const add = (id: string | null) => {
    if (!id || seen.has(id)) return;
    const player = byId.get(id);
    if (!player) return;
    seen.add(id);
    out.push(player);
  };
  draftOrder.forEach(add);
  adjustments.forEach((a) => add(a.playerId));
  return out;
}

function adjustmentLine(a: Adjustment): Line {
  return { category: 'adjustment', label: `Adjustment: ${a.reason}`, points: a.points };
}

export function scoreRound(
  eventScores: Map<string, TeamScore>,
  picks: Pick[],
  adjustments: Adjustment[],
  players: Player[],
): PlayerRoundScore[] {
  const ordered = [...picks].sort((a, b) => a.pickNumber - b.pickNumber);

  const rows = players.map((player) => {
    const teams: TeamScore[] = ordered
      .filter((p) => p.playerId === player.id)
      .map((p) => {
        const base = eventScores.get(p.teamKey);
        const extra = adjustments.filter((a) => a.teamKey === p.teamKey).map(adjustmentLine);
        const lines = [...(base?.lines ?? []), ...extra];
        return { teamKey: p.teamKey, total: lines.reduce((sum, l) => sum + l.points, 0), lines };
      });
    const own = adjustments.filter((a) => a.playerId === player.id).map(adjustmentLine);
    const total =
      teams.reduce((sum, t) => sum + t.total, 0) + own.reduce((sum, l) => sum + l.points, 0);
    return { playerId: player.id, name: player.name, total, teams, adjustments: own };
  });

  return rankByTotal(rows);
}

export function seasonStandings(players: Player[], rounds: PlayerRoundScore[][]): SeasonRow[] {
  const rows = players.map((player) => {
    const perRound = rounds.map((round) => round.find((r) => r.playerId === player.id)?.total ?? 0);
    return {
      playerId: player.id,
      name: player.name,
      total: perRound.reduce((sum, n) => sum + n, 0),
      perRound,
    };
  });
  return rankByTotal(rows).map((r) => ({
    playerId: r.playerId,
    name: r.name,
    total: r.total,
    rank: r.rank,
    perRound: r.perRound,
  }));
}
