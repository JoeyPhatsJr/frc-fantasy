import type { z } from 'zod';
import { getRepo } from '@/lib/db';
import { DbUnavailableError, UniqueViolation } from '@/lib/db/repo';
import type { LeagueRow, RoundRow } from '@/lib/db/types';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** A machine-readable reason the browser can switch on (for example the live-draft 409s). */
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export const DB_ASLEEP_MESSAGE =
  'The league database is asleep — the commissioner needs to wake it up';

const CONSTRAINT_MESSAGES: Record<string, string> = {
  picks_round_team_key: 'That team was just taken',
  picks_round_pick_number_key: 'Draft changed in another tab — refresh',
  players_league_name_ci: "There's already a player with that name",
  players_league_user: "You're already in this league",
  rounds_league_event_key: 'That event is already in this league',
};

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

export function jsonError(status: number, message: string): Response {
  return json({ error: message }, status);
}

/** Wrap every route handler body in this. It is the one place errors become responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) {
      return json(err.code ? { error: err.message, code: err.code } : { error: err.message }, err.status);
    }
    if (err instanceof UniqueViolation) {
      return jsonError(409, CONSTRAINT_MESSAGES[err.constraint] ?? 'That already exists');
    }
    if (err instanceof DbUnavailableError) {
      // Logged so a paused database can be told apart from a missing env var in the function logs.
      console.error(err);
      return jsonError(503, DB_ASLEEP_MESSAGE);
    }
    console.error(err);
    return jsonError(500, 'Something went wrong');
  }
}

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, 'Request body must be JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    // Custom messages written in our schemas already read well on their own.
    const custom = issue.code === 'custom' || !/^(Invalid|Too|Unrecognized)/.test(issue.message);
    throw new HttpError(400, custom ? issue.message : `${where}${issue.message}`);
  }
  return parsed.data;
}

export async function requireRound(league: LeagueRow, roundId: string): Promise<RoundRow> {
  if (!isUuid(roundId)) throw new HttpError(404, 'Round not found');
  const round = await getRepo().getRound(roundId);
  if (!round || round.leagueId !== league.id) throw new HttpError(404, 'Round not found');
  return round;
}
