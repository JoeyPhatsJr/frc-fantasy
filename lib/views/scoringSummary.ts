import { signed, ordinal } from '@/lib/format';
import { awardName } from '@/lib/scoring/awardTypes';
import type { ScoringConfig } from '@/lib/scoring/config';

/** "1 pt", "3 pts", "-2 pts". */
function pts(n: number): string {
  return `${n} ${Math.abs(n) === 1 ? 'pt' : 'pts'}`;
}

/** "+1 pt", "+10 pts", "-2 pts": for one-off bonuses. */
function bonus(n: number): string {
  return `${signed(n)} ${Math.abs(n) === 1 ? 'pt' : 'pts'}`;
}

const ALLIANCE: { key: keyof ScoringConfig['alliance']; label: string }[] = [
  { key: 'captain', label: 'Alliance captain' },
  { key: 'pick1', label: 'Alliance first pick' },
  { key: 'pick2', label: 'Alliance second pick' },
  { key: 'pick3', label: 'Alliance third pick' },
  { key: 'backup', label: 'Alliance backup robot' },
];

/**
 * The round's scoring config in plain words, one line per rule, for the "How scoring works" sheet
 * (spec §6.5). Rules worth 0 are left out. Mirrors lib/scoring (read-only): rank tiers are
 * first-match in ascending maxRank; excluded award types never score.
 */
export function scoringSummary(config: ScoringConfig): string[] {
  const out: string[] = [];
  const each = (label: string, n: number) => {
    if (n !== 0) out.push(`${label}: ${pts(n)}`);
  };
  const once = (label: string, n: number) => {
    if (n !== 0) out.push(`${label}: ${bonus(n)}`);
  };

  each('Each qualification win', config.qualWin);
  each('Each tie', config.qualTie);
  each('Each qualification loss', config.qualLoss);
  each('Each ranking point', config.rankingPoint);

  let from = 1;
  for (const tier of config.rankTiers) {
    const range = from === tier.maxRank ? ordinal(from) : `${ordinal(from)}–${ordinal(tier.maxRank)}`;
    once(`Ranked ${range} after qualification matches`, tier.points);
    from = tier.maxRank + 1;
  }

  for (const { key, label } of ALLIANCE) once(label, config.alliance[key]);
  each('Each playoff match win', config.playoffMatchWin);
  once('Event winner', config.eventWinner);
  once('Finalist', config.eventFinalist);

  const excluded = new Set(config.awards.excludedTypes);
  const named = Object.entries(config.awards.byType)
    .map(([type, n]) => ({ type: Number(type), n }))
    .filter(({ type }) => !excluded.has(type))
    .sort((a, b) => a.type - b.type);
  for (const { type, n } of named) once(awardName(type), n);
  once(named.length > 0 ? 'Any other team award' : 'Each team award', config.awards.default);

  const opr = config.oprBonus;
  if (opr.some((n) => n !== 0)) {
    const label = opr.length === 1 ? 'Best robot rating (OPR)' : `Top ${opr.length} robot ratings (OPR)`;
    const values = opr.map((n) => signed(n)).join(' / ');
    out.push(`${label} after qualification matches: ${values} ${opr.length === 1 && Math.abs(opr[0]) === 1 ? 'pt' : 'pts'}`);
  }
  return out;
}
