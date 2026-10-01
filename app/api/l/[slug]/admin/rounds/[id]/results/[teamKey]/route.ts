import { z } from 'zod';
import { handle, HttpError, json, noContent, parseBody, requireRound } from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { loadPool } from '@/lib/rounds/pool';
import { parseTeamInput } from '@/lib/teams';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string; teamKey: string }> };

const whole = (what: string, min: number, max: number) => {
  const msg = `${what} must be a whole number from ${min} to ${max}`;
  return z.number(msg).int(msg).min(min, msg).max(max, msg);
};

const bodySchema = z.strictObject({
  qualWins: whole('Qual wins', 0, 50).default(0),
  qualLosses: whole('Qual losses', 0, 50).default(0),
  qualTies: whole('Qual ties', 0, 50).default(0),
  rankingPoints: whole('Ranking points', 0, 500).nullable().default(null),
  qualRank: whole('Rank', 1, 200).nullable().default(null),
  allianceRole: z
    .enum(['captain', 'pick1', 'pick2', 'pick3', 'backup'], 'Alliance role must be captain, pick1, pick2, pick3 or backup')
    .nullable()
    .default(null),
  playoffWins: whole('Playoff wins', 0, 20).default(0),
  eventResult: z.enum(['winner', 'finalist'], 'Event result must be winner or finalist').nullable().default(null),
  awardTypes: z
    .array(whole('Award type', 0, 1000))
    .max(10, 'At most 10 awards per team')
    .refine((a) => new Set(a).size === a.length, 'Each award can only be listed once')
    .default([]),
});

async function manualTarget(ctx: Ctx) {
  const { slug, id, teamKey: raw } = await ctx.params;
  const { league } = await requireLeagueRole(slug, 'commissioner');
  const round = await requireRound(league, id);
  if (round.kind !== 'manual') throw new HttpError(409, 'Results can only be entered for manual events');
  const teamKey = parseTeamInput(raw);
  if (!teamKey) throw new HttpError(400, 'Team numbers look like 341');
  return { round, teamKey };
}

export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { round, teamKey } = await manualTarget(ctx);
    const body = await parseBody(req, bodySchema);
    const pool = await loadPool(round, new Date());
    if (!pool.teams.some((t) => t.teamKey === teamKey)) {
      throw new HttpError(400, "That team isn't in this round's team pool");
    }
    const { roundId: _roundId, ...result } = await getRepo().upsertManualResult({ roundId: round.id, teamKey, ...body });
    return json({ result });
  });
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { round, teamKey } = await manualTarget(ctx);
    await getRepo().deleteManualResult(round.id, teamKey);
    return noContent();
  });
}
