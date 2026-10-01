import { z } from 'zod';
import type { CategoryId, EventScores, Line, RpMethod, TeamScore } from '@/lib/scoring/types';
import type { EventInfo } from '@/lib/tba/clean';

// Record<…, true> makes TypeScript fail here if a CategoryId or RpMethod is added without updating the validator.
const CATEGORIES: Record<CategoryId, true> = {
  qualRecord: true,
  rankingPoints: true,
  rank: true,
  alliance: true,
  playoffWins: true,
  eventResult: true,
  awards: true,
  oprBonus: true,
  adjustment: true,
};

const RP_METHODS: Record<RpMethod, true> = {
  extra_stats: true,
  sort_order_avg: true,
  none: true,
};

const lineSchema = z.object({
  category: z.string().refine((c) => Object.hasOwn(CATEGORIES, c)),
  label: z.string(),
  quantity: z.number().optional(),
  points: z.number(),
});

const serializedSchema = z.object({
  teams: z.record(
    z.string(),
    z.object({ teamKey: z.string(), total: z.number(), lines: z.array(lineSchema) }),
  ),
  qualsComplete: z.boolean(),
  rpMethod: z.string().refine((m) => Object.hasOwn(RP_METHODS, m)),
});

const infoSchema = z.object({
  teamNames: z.record(z.string(), z.string()),
  hasEventData: z.boolean(),
  hasRankings: z.boolean(),
});

/** event_scores.scores (spec §5.6): EventScores with the teams Map written as a plain object. */
export type SerializedEventScores = {
  teams: Record<string, TeamScore>;
  qualsComplete: boolean;
  rpMethod: RpMethod;
};

export function serializeEventScores(s: EventScores): SerializedEventScores {
  return { teams: Object.fromEntries(s.teams), qualsComplete: s.qualsComplete, rpMethod: s.rpMethod };
}

/** Null when the stored JSON has the wrong shape; the caller then treats it as a cache miss. */
export function deserializeEventScores(raw: unknown): EventScores | null {
  const parsed = serializedSchema.safeParse(raw);
  if (!parsed.success) return null;
  const teams = new Map<string, TeamScore>();
  for (const [key, t] of Object.entries(parsed.data.teams)) {
    teams.set(key, { teamKey: t.teamKey, total: t.total, lines: t.lines as Line[] });
  }
  return { teams, qualsComplete: parsed.data.qualsComplete, rpMethod: parsed.data.rpMethod as RpMethod };
}

export function parseEventInfo(raw: unknown): EventInfo | null {
  const parsed = infoSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
