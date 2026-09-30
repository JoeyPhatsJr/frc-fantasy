import { z } from 'zod';

const points = z.number().int().min(-1000).max(1000);

export const scoringConfigSchema = z.object({
  version: z.literal(1),
  qualWin: points,
  qualTie: points,
  qualLoss: points,
  rankingPoint: points,
  rankTiers: z
    .array(z.object({ maxRank: z.number().int().min(1).max(1000), points }))
    .max(20)
    .refine((tiers) => tiers.every((t, i) => i === 0 || t.maxRank > tiers[i - 1].maxRank), {
      message: 'Rank tiers must go in ascending order of max rank',
    }),
  alliance: z.object({
    captain: points,
    pick1: points,
    pick2: points,
    pick3: points,
    backup: points,
  }),
  playoffMatchWin: points,
  eventWinner: points,
  eventFinalist: points,
  awards: z.object({
    byType: z.record(z.string().regex(/^\d+$/), points),
    excludedTypes: z.array(z.number().int().min(0)).max(200),
    default: points,
  }),
  oprBonus: z.array(points).max(10),
});

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

export const DEFAULT_SCORING: ScoringConfig = {
  version: 1,
  qualWin: 3,
  qualTie: 1,
  qualLoss: 0,
  rankingPoint: 1,
  rankTiers: [
    { maxRank: 1, points: 10 },
    { maxRank: 8, points: 5 },
    { maxRank: 16, points: 2 },
  ],
  alliance: { captain: 8, pick1: 6, pick2: 3, pick3: 2, backup: 2 },
  playoffMatchWin: 4,
  eventWinner: 15,
  eventFinalist: 8,
  awards: {
    byType: { '0': 10, '9': 8, '10': 6 },
    excludedTypes: [1, 2, 3, 4, 5, 6, 7, 14, 39],
    default: 5,
  },
  oprBonus: [6, 4, 2],
};

export function defaultScoring(): ScoringConfig {
  return structuredClone(DEFAULT_SCORING);
}
