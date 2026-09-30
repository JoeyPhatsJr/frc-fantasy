import type { Repo } from '@/lib/db/repo';

/** Players who can't be removed: in a draft order, or holding picks or adjustments (spec §5.4). */
export async function playersInUse(repo: Repo, leagueId: string): Promise<Set<string>> {
  const rounds = await repo.listRounds(leagueId);
  const roundIds = rounds.map((r) => r.id);
  const [picks, adjustments] = await Promise.all([
    repo.listPicksForRounds(roundIds),
    repo.listAdjustmentsForRounds(roundIds),
  ]);
  const used = new Set<string>();
  for (const r of rounds) for (const id of r.draftOrder) used.add(id);
  for (const p of picks) used.add(p.playerId);
  for (const a of adjustments) if (a.playerId) used.add(a.playerId);
  return used;
}
