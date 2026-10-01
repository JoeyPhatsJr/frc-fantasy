import { z } from 'zod';
import { HttpError } from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import type { LeagueRow, RoundRow } from '@/lib/db/types';
import { MAX_FOLLOWS } from '@/lib/follow/input';
import { syncFollowedEvents } from '@/lib/follow/sync';
import {
  allowedSeasonYears,
  DEFAULT_SEASON_ROSTER,
  defaultSeasonYear,
  SEASON_TIMEZONE,
  seasonRoundName,
} from '@/lib/season/calendar';
import { fetchSeasonDates } from '@/lib/season/fetchDates';
import { DEFAULT_POOL_FILTER, type PoolFilter, poolFilterSchema } from '@/lib/season/poolFilter';

const TEAM_MSG = 'Team numbers are 1 to 99999';

/** Format fields of POST /api/leagues (spec §4.4, §5). Merged into SP1's body schema. */
export const formatOptionsSchema = z.object({
  format: z.enum(['event', 'season'], 'Format must be event or season').default('event'),
  followTeams: z
    .array(z.number(TEAM_MSG).int(TEAM_MSG).min(1, TEAM_MSG).max(99999, TEAM_MSG))
    .max(MAX_FOLLOWS, `Follow at most ${MAX_FOLLOWS} teams`)
    .refine((t) => new Set(t).size === t.length, 'Each team can only be followed once')
    .optional(),
  seasonYear: z.number('Season year must be a year').int('Season year must be a year').optional(),
  poolFilter: poolFilterSchema.optional(),
});
export type FormatOptions = z.infer<typeof formatOptionsSchema>;

export async function createSeasonRound(
  league: LeagueRow,
  input: { year: number; poolFilter: PoolFilter; rosterSize?: number; draftOrder?: string[] },
): Promise<RoundRow> {
  const dates = await fetchSeasonDates(input.year); // Jan 1 – Dec 31 until TBA publishes the calendar
  return getRepo().createRound({
    leagueId: league.id,
    kind: 'season',
    eventKey: null,
    seasonYear: input.year,
    eventName: seasonRoundName(input.year),
    startDate: dates.startDate,
    endDate: dates.endDate,
    timezone: SEASON_TIMEZONE,
    scoring: structuredClone(league.defaultScoring),
    poolFilter: input.poolFilter,
    rosterSize: input.rosterSize ?? DEFAULT_SEASON_ROSTER,
    draftOrder: input.draftOrder ?? [],
  });
}

/**
 * Checks the season year and district before anything is written, so a bad request never leaves a
 * half-made league. Returns the resolved year and filter for season leagues (null for event leagues).
 */
export function checkFormatOptions(options: FormatOptions, now: Date): { year: number; filter: PoolFilter } | null {
  if (options.format !== 'season') return null;
  const year = options.seasonYear ?? defaultSeasonYear(now);
  const allowed = allowedSeasonYears(now);
  if (!allowed.includes(year)) throw new HttpError(400, `Pick the ${allowed[0]} or ${allowed[1]} season`);
  const filter = options.poolFilter ?? DEFAULT_POOL_FILTER;
  if (filter.type === 'district' && !filter.key.startsWith(String(year))) {
    throw new HttpError(400, `Pick a district from the ${year} season`);
  }
  return { year, filter };
}

/** Runs right after SP1 creates the league (and its commissioner row). */
export async function setUpLeagueFormat(league: LeagueRow, options: FormatOptions, now: Date): Promise<void> {
  const season = checkFormatOptions(options, now);
  if (season) {
    await createSeasonRound(league, { year: season.year, poolFilter: season.filter });
    return;
  }
  if (options.followTeams && options.followTeams.length > 0) {
    await getRepo().setFollows(league.id, options.followTeams);
    await syncFollowedEvents(league, now); // a TBA failure here is fine: the next visit or cron retries
  }
}
