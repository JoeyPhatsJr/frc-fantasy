import { z } from 'zod';
import {
  handle,
  HttpError,
  json,
  noContent,
  parseBody,
  requireRound,
  UUID_RE,
} from '@/lib/api/http';
import { requireLeagueRole } from '@/lib/auth/roles';
import { getRepo } from '@/lib/db';
import { roundDetail } from '@/lib/rounds/detail';
import { loadPool } from '@/lib/rounds/pool';
import { scoringConfigSchema } from '@/lib/scoring/config';
import { MAX_SEASON_ROSTER } from '@/lib/season/calendar';
import { poolFilterSchema } from '@/lib/season/poolFilter';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ slug: string; id: string }> };

const patchSchema = z
  .strictObject({
    // Type-only here: the range depends on the round's kind (1–10, or 1–15 for season rounds).
    rosterSize: z.number('Roster size must be a whole number from 1 to 10').optional(),
    poolFilter: poolFilterSchema.optional(),
    draftOrder: z
      .array(z.string().regex(UUID_RE, 'Draft order must be a list of player ids'))
      .max(50, 'Too many players in the draft order')
      .optional(),
    scoring: scoringConfigSchema.optional(),
    draftMode: z.enum(['commissioner', 'live'], 'draftMode must be commissioner or live').optional(),
    pickSeconds: z
      .union([z.literal(30), z.literal(60), z.literal(90), z.literal(120), z.null()], {
        error: 'The pick timer must be off, 30, 60, 90, or 120 seconds',
      })
      .optional(),
    finalized: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change' });

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const round = await requireRound(league, id);
    return json(await roundDetail(round, new Date()));
  });
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const round = await requireRound(league, id);
    const patch = await parseBody(req, patchSchema);
    const repo = getRepo();
    const now = new Date();

    if (patch.rosterSize !== undefined) {
      const max = round.kind === 'season' ? MAX_SEASON_ROSTER : 10;
      if (!Number.isInteger(patch.rosterSize) || patch.rosterSize < 1 || patch.rosterSize > max) {
        throw new HttpError(400, `Roster size must be a whole number from 1 to ${max}`);
      }
    }
    // Spec §5.5: the pool filter is editable only while the round has no picks (and, per SP4, before the start).
    if (patch.poolFilter !== undefined) {
      if (round.kind !== 'season') throw new HttpError(409, 'Only season rounds have a team pool filter');
      if (round.draftStartedAt || (await repo.listPicks(round.id)).length > 0) {
        throw new HttpError(409, 'Undo all picks to change the team pool');
      }
      if (patch.poolFilter.type === 'district' && !patch.poolFilter.key.startsWith(String(round.seasonYear))) {
        throw new HttpError(400, `Pick a district from the ${round.seasonYear} season`);
      }
    }
    // The size check below must use the filter being saved, not the old one.
    const poolRound = patch.poolFilter ? { ...round, poolFilter: patch.poolFilter } : round;

    // v2 §7.1 / §7.3: live-draft settings and locks.
    if (patch.draftMode !== undefined && patch.draftMode !== round.draftMode) {
      if (round.draftStartedAt) throw new HttpError(409, 'The draft has already started');
      if ((await repo.listPicks(round.id)).length > 0) {
        throw new HttpError(409, 'Undo all picks to change the draft mode');
      }
    }
    let pausedRemainingMs: null | undefined;
    if (patch.pickSeconds !== undefined && patch.pickSeconds !== round.pickSeconds) {
      if (round.draftStartedAt && !round.draftPausedAt) {
        throw new HttpError(409, 'Pause the draft to change the timer');
      }
      if (round.draftPausedAt) pausedRemainingMs = null; // resume gives the full new timer
    }

    const rosterSize = patch.rosterSize ?? round.rosterSize;
    const draftOrder = patch.draftOrder ?? round.draftOrder;
    const draftChanged =
      rosterSize !== round.rosterSize ||
      draftOrder.length !== round.draftOrder.length ||
      draftOrder.some((playerId, i) => playerId !== round.draftOrder[i]);

    if (draftChanged) {
      if (round.draftStartedAt) {
        throw new HttpError(409, 'The draft has started — the order and roster size are locked');
      }
      const picks = await repo.listPicks(round.id);
      if (picks.length > 0) {
        throw new HttpError(409, 'Undo all picks to change the draft order or roster size');
      }
      if (new Set(draftOrder).size !== draftOrder.length) {
        throw new HttpError(400, 'A player can only appear once in the draft order');
      }
      const playerIds = new Set((await repo.listPlayers(league.id)).map((p) => p.id));
      if (draftOrder.some((playerId) => !playerIds.has(playerId))) {
        throw new HttpError(400, "The draft order includes someone who isn't a player in this league");
      }
    }

    // v1's P × R ≤ T rule, re-checked when the order, roster size, or (season) pool filter changes.
    const P = draftOrder.length;
    if (P > 0 && (draftChanged || patch.poolFilter !== undefined)) {
      const pool = await loadPool(poolRound, now);
      const unknown = pool.stale && pool.tbaCount === 0;
      // Season rounds: TBA hasn't published the year's teams yet (spec §5.5).
      const emptyMessage = pool.teams.length === 0 ? pool.emptyMessage : null;
      if (draftChanged) {
        if (unknown) {
          // TBA was never reached (or has no list yet): the team count is unknown, not zero.
          throw new HttpError(503, "Couldn't reach The Blue Alliance for the team list. Try again in a minute.");
        }
        if (emptyMessage) throw new HttpError(409, emptyMessage);
      }
      // A filter alone can still be chosen before TBA publishes the year's teams; draft start re-checks.
      if (!unknown && !emptyMessage) {
        const T = pool.teams.length;
        if (P * rosterSize > T) {
          const max = Math.floor(T / P);
          throw new HttpError(
            400,
            max < 1
              ? `There are only ${T} teams for ${P} players. Add teams to the pool first.`
              : `With ${P} players and ${T} teams, roster size can be at most ${max}`,
          );
        }
      }
    }

    const saved = await repo.updateRound(round.id, {
      rosterSize: patch.rosterSize,
      draftOrder: patch.draftOrder,
      scoring: patch.scoring,
      draftMode: patch.draftMode,
      pickSeconds: patch.pickSeconds,
      poolFilter: patch.poolFilter,
      pausedRemainingMs,
      finalizedAt:
        patch.finalized === undefined ? undefined : patch.finalized ? now.toISOString() : null,
    });
    return json(await roundDetail(saved, now));
  });
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const { league } = await requireLeagueRole(slug, 'commissioner');
    const round = await requireRound(league, id);
    const repo = getRepo();
    if (round.kind === 'season') {
      // Final review I4: season leagues can't add rounds, so deleting the last season would
      // leave the league empty for good ("Start next season" needs a season to copy).
      const seasons = (await repo.listRounds(league.id)).filter((r) => r.kind === 'season');
      if (seasons.length <= 1) {
        throw new HttpError(409, 'A full-season league needs its season. Delete the league instead.');
      }
    }
    if (round.autoAdded && round.eventKey) {
      // Spec §5.4: a deleted auto-added round must never come back on the next sync.
      await repo.addSkippedEvent(league.id, round.eventKey);
    }
    await repo.deleteRound(round.id);
    return noContent();
  });
}
