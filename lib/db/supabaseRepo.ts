import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { generateInviteCode } from '@/lib/leagues/inviteCode';
import { bodyHash } from '@/lib/scores/hash';
import { DbUnavailableError, UniqueViolation, type NewRound, type Repo } from '@/lib/db/repo';
import type {
  AdjustmentRow,
  CacheMeta,
  CacheRow,
  EventScoresRow,
  LeagueRow,
  ManualResultRow,
  PickRow,
  PlayerRow,
  ProfileRow,
  RoundRow,
  TeamStatsRow,
} from '@/lib/db/types';

// Database rows arrive in snake_case. These mappers are the only place that knows that.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

const toProfile = (r: Raw): ProfileRow => ({
  id: r.id,
  displayName: r.display_name,
  avatarUrl: r.avatar_url ?? null,
  frcTeam: r.frc_team ?? null,
  createdAt: r.created_at,
});

const toLeague = (r: Raw): LeagueRow => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  adminTokenHash: r.admin_token_hash ?? null,
  homeTeamNumber: r.home_team_number,
  defaultScoring: r.default_scoring,
  inviteCode: r.invite_code,
  visibility: r.visibility,
  createdBy: r.created_by ?? null,
  format: r.format ?? 'event',
  followsSyncedAt: r.follows_synced_at ?? null,
  createdAt: r.created_at,
});
const toPlayer = (r: Raw): PlayerRow => ({
  id: r.id,
  leagueId: r.league_id,
  name: r.name,
  userId: r.user_id ?? null,
  role: r.role,
  createdAt: r.created_at,
});
const toRound = (r: Raw): RoundRow => ({
  id: r.id,
  leagueId: r.league_id,
  eventKey: r.event_key,
  eventName: r.event_name,
  startDate: r.start_date,
  endDate: r.end_date,
  timezone: r.timezone,
  rosterSize: r.roster_size,
  draftOrder: r.draft_order ?? [],
  scoring: r.scoring,
  finalizedAt: r.finalized_at,
  draftMode: r.draft_mode ?? 'commissioner',
  pickSeconds: r.pick_seconds ?? null,
  draftStartedAt: r.draft_started_at ?? null,
  draftPausedAt: r.draft_paused_at ?? null,
  pausedRemainingMs: r.paused_remaining_ms ?? null,
  pickDeadline: r.pick_deadline ?? null,
  kind: r.kind ?? 'tba',
  seasonYear: r.season_year ?? null,
  poolFilter: r.pool_filter ?? null,
  autoAdded: r.auto_added ?? false,
  autoFinalize: r.auto_finalize ?? true,
  createdAt: r.created_at,
});
const toManualResult = (r: Raw): ManualResultRow => ({
  roundId: r.round_id,
  teamKey: r.team_key,
  qualWins: r.qual_wins,
  qualLosses: r.qual_losses,
  qualTies: r.qual_ties,
  rankingPoints: r.ranking_points,
  qualRank: r.qual_rank,
  allianceRole: r.alliance_role,
  playoffWins: r.playoff_wins,
  eventResult: r.event_result,
  awardTypes: r.award_types ?? [],
});

const toPick = (r: Raw): PickRow => ({
  id: r.id,
  roundId: r.round_id,
  pickNumber: r.pick_number,
  playerId: r.player_id,
  teamKey: r.team_key,
  auto: r.auto ?? false,
  createdAt: r.created_at,
});
const toAdjustment = (r: Raw): AdjustmentRow => ({
  id: r.id,
  roundId: r.round_id,
  playerId: r.player_id,
  teamKey: r.team_key,
  points: r.points,
  reason: r.reason,
  createdAt: r.created_at,
});
const toCache = (r: Raw): CacheRow => ({
  path: r.path,
  etag: r.etag,
  body: r.body,
  fetchedAt: r.fetched_at,
  lastError: r.last_error,
  lastErrorAt: r.last_error_at,
});
const toCacheMeta = (r: Raw): CacheMeta => ({
  path: r.path,
  fetchedAt: r.fetched_at,
  bodyHash: r.body_hash,
  lastErrorAt: r.last_error_at,
});

/** Splits a list so `.in(...)` filters stay well under PostgREST's URL length limit. */
const toEventScores = (r: Raw): EventScoresRow => ({
  eventKey: r.event_key,
  configHash: r.config_hash,
  sourceStamp: r.source_stamp,
  scores: r.scores,
  info: r.info,
  computedAt: r.computed_at,
});

const SUMMARY_COLUMNS =
  'team_key, season, events_played, total_points, qual_wins, qual_losses, qual_ties, best_finish, latest_event_key, latest_opr, latest_rank, updated_at';

const toTeamStats = (r: Raw): TeamStatsRow => ({
  teamKey: r.team_key,
  season: r.season,
  eventsPlayed: r.events_played,
  totalPoints: r.total_points,
  qualWins: r.qual_wins,
  qualLosses: r.qual_losses,
  qualTies: r.qual_ties,
  bestFinish: r.best_finish,
  awards: Array.isArray(r.awards) ? r.awards : [],
  events: Array.isArray(r.events) ? r.events : [],
  latestEventKey: r.latest_event_key,
  // numeric(6,1) arrives as a string or a number depending on the driver path.
  latestOpr: r.latest_opr === null || r.latest_opr === undefined ? null : Number(r.latest_opr),
  latestRank: r.latest_rank,
  updatedAt: r.updated_at,
});

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Drops keys whose value is undefined, so a patch only touches the columns it names. */
function defined(obj: Raw): Raw {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function roundInsert(input: NewRound): Raw {
  return defined({
    league_id: input.leagueId,
    event_key: input.eventKey,
    event_name: input.eventName,
    start_date: input.startDate,
    end_date: input.endDate,
    timezone: input.timezone,
    scoring: input.scoring,
    kind: input.kind,
    season_year: input.seasonYear,
    pool_filter: input.poolFilter,
    auto_added: input.autoAdded,
    roster_size: input.rosterSize,
    draft_order: input.draftOrder,
  });
}

type Result = { data: unknown; error: { code?: string; message: string } | null; status?: number };

async function run(query: PromiseLike<Result>): Promise<Raw[]> {
  let res: Result;
  try {
    res = await query;
  } catch (err) {
    throw new DbUnavailableError(err instanceof Error ? err.message : String(err));
  }
  if (res.error) {
    if (res.error.code === '23505') {
      const m = /unique constraint "([^"]+)"/.exec(res.error.message);
      throw new UniqueViolation(m?.[1] ?? 'unknown');
    }
    // The database could not be reached: no code at all, PostgREST's "cannot connect" codes
    // (PGRST000-003), a Node network error code (ECONNREFUSED, ETIMEDOUT, ...), or a gateway 5xx
    // (what a paused project can answer with).
    const { code } = res.error;
    if (
      !code ||
      /^PGRST00[0-3]$/.test(code) ||
      /^E[A-Z]+$/.test(code) ||
      (res.status !== undefined && res.status >= 500)
    ) {
      throw new DbUnavailableError(res.error.message);
    }
    throw new Error(`Database error ${res.error.code}: ${res.error.message}`);
  }
  if (res.data === null || res.data === undefined) return [];
  return Array.isArray(res.data) ? (res.data as Raw[]) : [res.data as Raw];
}

function first<T>(rows: Raw[], map: (r: Raw) => T, what: string): T {
  if (rows.length === 0) throw new Error(`${what} not found`);
  return map(rows[0]);
}

/** A Postgres function that returns boolean arrives as a bare `true`/`false`. */
async function rpcBool(query: PromiseLike<Result>): Promise<boolean> {
  const rows = await run(query);
  return (rows[0] as unknown) === true;
}

export function createSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new DbUnavailableError('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Spec §9.2: Next.js must never cache database reads.
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
}

export function createSupabaseRepo(db: SupabaseClient): Repo {
  return {
    async createLeague(input) {
      const rows = await run(
        db
          .from('leagues')
          .insert(
            defined({
              slug: input.slug,
              name: input.name,
              default_scoring: input.defaultScoring,
              admin_token_hash: input.adminTokenHash ?? null,
              visibility: input.visibility,
              created_by: input.createdBy ?? null,
              format: input.format,
              // invite_code comes from the column default, gen_invite_code()
            }),
          )
          .select(),
      );
      return first(rows, toLeague, 'league');
    },
    async getLeagueBySlug(slug) {
      const rows = await run(db.from('leagues').select().eq('slug', slug).limit(1));
      return rows[0] ? toLeague(rows[0]) : null;
    },
    async updateLeague(id, patch) {
      const rows = await run(
        db
          .from('leagues')
          .update(
            defined({
              name: patch.name,
              home_team_number: patch.homeTeamNumber,
              default_scoring: patch.defaultScoring,
              admin_token_hash: patch.adminTokenHash,
              visibility: patch.visibility,
              follows_synced_at: patch.followsSyncedAt,
            }),
          )
          .eq('id', id)
          .select(),
      );
      return first(rows, toLeague, 'league');
    },
    async deleteLeague(id) {
      await run(db.from('leagues').delete().eq('id', id));
    },
    async getLeagueByInviteCode(code) {
      const rows = await run(db.from('leagues').select().eq('invite_code', code).limit(1));
      return rows[0] ? toLeague(rows[0]) : null;
    },
    async resetInviteCode(leagueId) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const rows = await run(
            db.from('leagues').update({ invite_code: generateInviteCode() }).eq('id', leagueId).select(),
          );
          return first(rows, toLeague, 'league');
        } catch (err) {
          if (err instanceof UniqueViolation && err.constraint === 'leagues_invite_code_key') continue;
          throw err;
        }
      }
      throw new UniqueViolation('leagues_invite_code_key');
    },
    async countLeaguesCreatedBy(userId) {
      const rows = await run(db.from('leagues').select('id').eq('created_by', userId));
      return rows.length;
    },
    async listLeaguesForUser(userId) {
      const rows = await run(db.from('players').select('*, leagues(*)').eq('user_id', userId));
      return rows
        .map((r) => ({ league: toLeague(r.leagues), player: toPlayer(r) }))
        .sort((a, b) => a.league.createdAt.localeCompare(b.league.createdAt));
    },

    async listPlayers(leagueId) {
      const rows = await run(db.from('players').select().eq('league_id', leagueId).order('created_at'));
      return rows.map(toPlayer);
    },
    async createPlayer(leagueId, name) {
      const rows = await run(db.from('players').insert({ league_id: leagueId, name }).select());
      return first(rows, toPlayer, 'player');
    },
    async renamePlayer(id, name) {
      const rows = await run(db.from('players').update({ name }).eq('id', id).select());
      return first(rows, toPlayer, 'player');
    },
    async deletePlayer(id) {
      await run(db.from('players').delete().eq('id', id));
    },

    async createMember(input) {
      const rows = await run(
        db
          .from('players')
          .insert({ league_id: input.leagueId, user_id: input.userId, name: input.name, role: input.role })
          .select(),
      );
      return first(rows, toPlayer, 'player');
    },
    async getMemberByUser(leagueId, userId) {
      const rows = await run(
        db.from('players').select().eq('league_id', leagueId).eq('user_id', userId).limit(1),
      );
      return rows[0] ? toPlayer(rows[0]) : null;
    },
    async updatePlayer(id, patch) {
      const rows = await run(
        db
          .from('players')
          .update(defined({ name: patch.name, role: patch.role, user_id: patch.userId }))
          .eq('id', id)
          .select(),
      );
      return first(rows, toPlayer, 'player');
    },

    async getProfile(id) {
      const rows = await run(db.from('profiles').select().eq('id', id).limit(1));
      return rows[0] ? toProfile(rows[0]) : null;
    },
    async createProfile(input) {
      try {
        const rows = await run(
          db
            .from('profiles')
            .insert({ id: input.id, display_name: input.displayName, avatar_url: input.avatarUrl })
            .select(),
        );
        return first(rows, toProfile, 'profile');
      } catch (err) {
        // Two tabs finishing sign-in at once: the second insert loses, and that's fine.
        if (err instanceof UniqueViolation && err.constraint === 'profiles_pkey') {
          return first(await run(db.from('profiles').select().eq('id', input.id).limit(1)), toProfile, 'profile');
        }
        throw err;
      }
    },
    async updateProfile(id, patch) {
      const rows = await run(
        db
          .from('profiles')
          .update(defined({ display_name: patch.displayName, frc_team: patch.frcTeam }))
          .eq('id', id)
          .select(),
      );
      return first(rows, toProfile, 'profile');
    },
    async deleteUser(id) {
      const { error } = await db.auth.admin.deleteUser(id);
      if (error) throw new Error(`Couldn't delete the account: ${error.message}`);
    },

    async listRounds(leagueId) {
      const rows = await run(
        db.from('rounds').select().eq('league_id', leagueId).order('start_date').order('created_at'),
      );
      return rows.map(toRound);
    },
    async getRound(id) {
      const rows = await run(db.from('rounds').select().eq('id', id).limit(1));
      return rows[0] ? toRound(rows[0]) : null;
    },
    async createRound(input) {
      const rows = await run(db.from('rounds').insert(roundInsert(input)).select());
      return first(rows, toRound, 'round');
    },
    async createRoundIfAbsent(input) {
      // ON CONFLICT (league_id, event_key) DO NOTHING: a conflicting row comes back as an empty result.
      const rows = await run(
        db
          .from('rounds')
          .upsert(roundInsert(input), { onConflict: 'league_id,event_key', ignoreDuplicates: true })
          .select(),
      );
      return rows[0] ? toRound(rows[0]) : null;
    },
    async listOpenSeasonRounds() {
      const rows = await run(db.from('rounds').select().eq('kind', 'season').is('finalized_at', null));
      return rows.map(toRound);
    },
    async listAutoFinalizeCandidates() {
      const rows = await run(db.from('rounds').select().is('finalized_at', null).eq('auto_finalize', true));
      return rows.map(toRound);
    },

    async listManualResults(roundId) {
      const rows = await run(db.from('manual_results').select().eq('round_id', roundId).order('team_key'));
      return rows.map(toManualResult);
    },
    async upsertManualResult(row) {
      const rows = await run(
        db
          .from('manual_results')
          .upsert(
            {
              round_id: row.roundId,
              team_key: row.teamKey,
              qual_wins: row.qualWins,
              qual_losses: row.qualLosses,
              qual_ties: row.qualTies,
              ranking_points: row.rankingPoints,
              qual_rank: row.qualRank,
              alliance_role: row.allianceRole,
              playoff_wins: row.playoffWins,
              event_result: row.eventResult,
              award_types: row.awardTypes,
            },
            { onConflict: 'round_id,team_key' },
          )
          .select(),
      );
      return first(rows, toManualResult, 'manual result');
    },
    async deleteManualResult(roundId, teamKey) {
      await run(db.from('manual_results').delete().eq('round_id', roundId).eq('team_key', teamKey));
    },

    async listFollows(leagueId) {
      const rows = await run(db.from('league_follows').select('team_number').eq('league_id', leagueId).order('team_number'));
      return rows.map((r) => r.team_number as number);
    },
    async setFollows(leagueId, teamNumbers) {
      // Two statements, not a transaction: a crash in between leaves no follows, which is safe (sync adds nothing).
      await run(db.from('league_follows').delete().eq('league_id', leagueId));
      const unique = [...new Set(teamNumbers)];
      if (unique.length > 0) {
        await run(db.from('league_follows').insert(unique.map((n) => ({ league_id: leagueId, team_number: n }))));
      }
    },
    async listLeaguesWithFollows() {
      // The !inner embed keeps only leagues with at least one follow; PostgREST returns one row per league.
      const rows = await run(db.from('leagues').select('*, league_follows!inner(team_number)'));
      return rows.map(toLeague);
    },
    async listSkippedEvents(leagueId) {
      const rows = await run(db.from('league_skipped_events').select('event_key').eq('league_id', leagueId));
      return rows.map((r) => r.event_key as string);
    },
    async addSkippedEvent(leagueId, eventKey) {
      await run(
        db
          .from('league_skipped_events')
          .upsert({ league_id: leagueId, event_key: eventKey }, { onConflict: 'league_id,event_key', ignoreDuplicates: true }),
      );
    },
    async updateRound(id, patch) {
      const rows = await run(
        db
          .from('rounds')
          .update(
            defined({
              roster_size: patch.rosterSize,
              draft_order: patch.draftOrder,
              scoring: patch.scoring,
              finalized_at: patch.finalizedAt,
              draft_mode: patch.draftMode,
              pick_seconds: patch.pickSeconds,
              paused_remaining_ms: patch.pausedRemainingMs,
              start_date: patch.startDate,
              end_date: patch.endDate,
              pool_filter: patch.poolFilter,
              auto_finalize: patch.autoFinalize,
            }),
          )
          .eq('id', id)
          .select(),
      );
      return first(rows, toRound, 'round');
    },
    async deleteRound(id) {
      await run(db.from('rounds').delete().eq('id', id));
    },

    async listExtraTeams(roundId) {
      const rows = await run(db.from('round_extra_teams').select().eq('round_id', roundId));
      return rows.map((r) => r.team_key as string);
    },
    async addExtraTeam(roundId, teamKey) {
      await run(
        db
          .from('round_extra_teams')
          .upsert({ round_id: roundId, team_key: teamKey }, { onConflict: 'round_id,team_key' }),
      );
    },
    async removeExtraTeam(roundId, teamKey) {
      await run(db.from('round_extra_teams').delete().eq('round_id', roundId).eq('team_key', teamKey));
    },

    async listPicks(roundId) {
      const rows = await run(db.from('picks').select().eq('round_id', roundId).order('pick_number'));
      return rows.map(toPick);
    },
    async listPicksForRounds(roundIds) {
      if (roundIds.length === 0) return [];
      const rows = await run(db.from('picks').select().in('round_id', roundIds).order('pick_number'));
      return rows.map(toPick);
    },
    async insertPick(input) {
      const rows = await run(
        db
          .from('picks')
          .insert({
            round_id: input.roundId,
            pick_number: input.pickNumber,
            player_id: input.playerId,
            team_key: input.teamKey,
            auto: input.auto ?? false,
          })
          .select(),
      );
      return first(rows, toPick, 'pick');
    },
    async deletePick(roundId, pickNumber) {
      await run(db.from('picks').delete().eq('round_id', roundId).eq('pick_number', pickNumber));
    },
    async updatePickTeam(roundId, pickNumber, teamKey) {
      const rows = await run(
        db
          .from('picks')
          .update({ team_key: teamKey })
          .eq('round_id', roundId)
          .eq('pick_number', pickNumber)
          .select(),
      );
      return first(rows, toPick, 'pick');
    },

    async listAdjustments(roundId) {
      const rows = await run(db.from('adjustments').select().eq('round_id', roundId).order('created_at'));
      return rows.map(toAdjustment);
    },
    async listAdjustmentsForRounds(roundIds) {
      if (roundIds.length === 0) return [];
      const rows = await run(
        db.from('adjustments').select().in('round_id', roundIds).order('created_at'),
      );
      return rows.map(toAdjustment);
    },
    async getAdjustment(id) {
      const rows = await run(db.from('adjustments').select().eq('id', id).limit(1));
      return rows[0] ? toAdjustment(rows[0]) : null;
    },
    async insertAdjustment(input) {
      const rows = await run(
        db
          .from('adjustments')
          .insert({
            round_id: input.roundId,
            player_id: input.playerId,
            team_key: input.teamKey,
            points: input.points,
            reason: input.reason,
          })
          .select(),
      );
      return first(rows, toAdjustment, 'adjustment');
    },
    async updateAdjustment(id, patch) {
      const rows = await run(
        db
          .from('adjustments')
          .update(
            defined({
              player_id: patch.playerId,
              team_key: patch.teamKey,
              points: patch.points,
              reason: patch.reason,
            }),
          )
          .eq('id', id)
          .select(),
      );
      return first(rows, toAdjustment, 'adjustment');
    },
    async deleteAdjustment(id) {
      await run(db.from('adjustments').delete().eq('id', id));
    },

    async getCache(path) {
      const rows = await run(db.from('tba_cache').select().eq('path', path).limit(1));
      return rows[0] ? toCache(rows[0]) : null;
    },
    async upsertCache(row) {
      await run(
        db.from('tba_cache').upsert(
          {
            path: row.path,
            etag: row.etag,
            body: row.body, // JS null is stored as SQL NULL
            body_hash: bodyHash(row.body), // computed here only (spec §5.6), so 304s keep the same hash
            fetched_at: row.fetchedAt,
            last_error: row.lastError,
            last_error_at: row.lastErrorAt,
          },
          { onConflict: 'path' },
        ),
      );
    },
    async getCacheMeta(paths) {
      if (paths.length === 0) return [];
      const batches = await Promise.all(
        chunks(paths, 100).map((batch) =>
          run(db.from('tba_cache').select('path, fetched_at, body_hash, last_error_at').in('path', batch)),
        ),
      );
      return batches.flat().map(toCacheMeta);
    },

    async makePickAtomic(input) {
      return rpcBool(
        db.rpc('draft_make_pick', {
          p_round_id: input.roundId,
          p_pick_number: input.pickNumber,
          p_player_id: input.playerId,
          p_team_key: input.teamKey,
          p_require_due: input.requireDue,
          p_auto: input.auto,
        }),
      );
    },
    async undoPickAtomic(roundId, pickNumber) {
      return rpcBool(db.rpc('draft_undo_pick', { p_round_id: roundId, p_pick_number: pickNumber }));
    },
    async draftControl(roundId, action) {
      return rpcBool(db.rpc('draft_control', { p_round_id: roundId, p_action: action }));
    },
    async getQueue(roundId, playerId) {
      const rows = await run(
        db.from('draft_queue').select('team_key').eq('round_id', roundId).eq('player_id', playerId).order('position'),
      );
      return rows.map((r) => r.team_key as string);
    },
    async setQueue(roundId, playerId, teamKeys) {
      // Two statements: only this player ever writes their own queue, so there's no race to guard.
      await run(db.from('draft_queue').delete().eq('round_id', roundId).eq('player_id', playerId));
      if (teamKeys.length === 0) return;
      await run(
        db.from('draft_queue').insert(
          teamKeys.map((teamKey, position) => ({ round_id: roundId, player_id: playerId, team_key: teamKey, position })),
        ),
      );
    },
    async getAutodraft(roundId, playerId) {
      const rows = await run(
        db.from('draft_prefs').select('autodraft').eq('round_id', roundId).eq('player_id', playerId),
      );
      return rows[0]?.autodraft === true;
    },
    async setAutodraft(roundId, playerId, on) {
      await run(
        db
          .from('draft_prefs')
          .upsert({ round_id: roundId, player_id: playerId, autodraft: on }, { onConflict: 'round_id,player_id' }),
      );
    },
    async listAutodraftPlayers(roundId) {
      const rows = await run(
        db.from('draft_prefs').select('player_id').eq('round_id', roundId).eq('autodraft', true),
      );
      return rows.map((r) => r.player_id as string);
    },
    async getEventScoresRow(eventKey, configHash) {
      const rows = await run(
        db.from('event_scores').select().eq('event_key', eventKey).eq('config_hash', configHash).limit(1),
      );
      return rows[0] ? toEventScores(rows[0]) : null;
    },
    async upsertEventScoresRow(row) {
      await run(
        db.from('event_scores').upsert(
          {
            event_key: row.eventKey,
            config_hash: row.configHash,
            source_stamp: row.sourceStamp,
            scores: row.scores,
            info: row.info,
            computed_at: row.computedAt,
          },
          { onConflict: 'event_key,config_hash' },
        ),
      );
    },
    async clearEventScores() {
      // PostgREST refuses an unfiltered delete; "every row has an event key" matches them all.
      const rows = await run(db.from('event_scores').delete().neq('event_key', '').select('event_key'));
      return rows.length;
    },
    async getTeamStats(teamKeys, seasons, opts = {}) {
      if (teamKeys.length === 0 || seasons.length === 0) return [];
      const columns = opts.withHistory ? '*' : SUMMARY_COLUMNS;
      const batches = await Promise.all(
        chunks(teamKeys, 150).map((batch) =>
          run(db.from('team_stats').select(columns).in('team_key', batch).in('season', seasons)),
        ),
      );
      return batches.flat().map(toTeamStats);
    },
    async upsertTeamStats(rows) {
      for (const batch of chunks(rows, 200)) {
        await run(
          db.from('team_stats').upsert(
            batch.map((r) => ({
              team_key: r.teamKey,
              season: r.season,
              events_played: r.eventsPlayed,
              total_points: r.totalPoints,
              qual_wins: r.qualWins,
              qual_losses: r.qualLosses,
              qual_ties: r.qualTies,
              best_finish: r.bestFinish,
              awards: r.awards,
              events: r.events,
              latest_event_key: r.latestEventKey,
              latest_opr: r.latestOpr,
              latest_rank: r.latestRank,
              updated_at: r.updatedAt,
            })),
            { onConflict: 'team_key,season' },
          ),
        );
      }
    },
    async rlsDisabledTables() {
      const rows = await run(db.rpc('public_tables_without_rls'));
      return rows.map((r) => (typeof r === 'string' ? r : String(Object.values(r)[0])));
    },
  };
}
