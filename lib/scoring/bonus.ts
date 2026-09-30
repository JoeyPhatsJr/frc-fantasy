import type { ScoringConfig } from '@/lib/scoring/config';
import type { Line } from '@/lib/scoring/types';
import type { Award, OprsResponse } from '@/lib/tba/types';

const OPR_EPSILON = 1e-6;

export function awardLines(awards: Award[] | null, config: ScoringConfig): Map<string, Line[]> {
  const out = new Map<string, Line[]>();
  const excluded = new Set(config.awards.excludedTypes);
  for (const award of awards ?? []) {
    if (excluded.has(award.award_type)) continue;
    const points = config.awards.byType[String(award.award_type)] ?? config.awards.default;
    const seen = new Set<string>();
    for (const recipient of award.recipient_list ?? []) {
      const team = recipient?.team_key;
      if (!team || seen.has(team)) continue;
      seen.add(team);
      const list = out.get(team) ?? [];
      list.push({ category: 'awards', label: award.name, points });
      out.set(team, list);
    }
  }
  return out;
}

/** Competition ranking by OPR, highest first. Ties share the better place: 1, 1, 3. */
export function oprRanks(oprs: OprsResponse | null): Map<string, number> {
  const entries = Object.entries(oprs?.oprs ?? {})
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const out = new Map<string, number>();
  let rank = 0;
  entries.forEach(([team, value], i) => {
    if (i === 0 || Math.abs(value - entries[i - 1][1]) >= OPR_EPSILON) rank = i + 1;
    out.set(team, rank);
  });
  return out;
}

export function oprLines(
  oprs: OprsResponse | null,
  config: ScoringConfig,
  qualsDone: boolean,
): Map<string, Line> {
  const out = new Map<string, Line>();
  if (!qualsDone) return out;
  for (const [team, rank] of oprRanks(oprs)) {
    out.set(team, {
      category: 'oprBonus',
      label: `OPR rank #${rank}`,
      quantity: rank,
      points: config.oprBonus[rank - 1] ?? 0,
    });
  }
  return out;
}
