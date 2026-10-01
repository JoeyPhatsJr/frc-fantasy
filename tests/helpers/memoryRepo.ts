import { randomUUID } from 'node:crypto';
import { generateInviteCode } from '@/lib/leagues/inviteCode';
import { nextDeadline, pausedRemainingMs, resumeDeadline, totalPicks } from '@/lib/draft/live';
import { UniqueViolation, type Repo } from '@/lib/db/repo';
import { bodyHash } from '@/lib/scores/hash';
import type {
  AdjustmentRow,
  CacheMeta,
  CacheRow,
  EventScoresRow,
  LeagueRow,
  PickRow,
  PlayerRow,
  ProfileRow,
  RoundRow,
  TeamStatsRow,
} from '@/lib/db/types';

/** A Repo that lives in memory and enforces the same unique constraints as the real schema.
 *  `now` is the "database clock" the live-draft functions use (Task 3); tests pass a fake one. */
export function createMemoryRepo(opts: { now?: () => Date } = {}): Repo {
  const dbNow = opts.now ?? (() => new Date());
  let leagues: LeagueRow[] = [];
  let players: PlayerRow[] = [];
  let profiles: ProfileRow[] = [];
  let rounds: RoundRow[] = [];
  let extraTeams: { roundId: string; teamKey: string }[] = [];
  let picks: PickRow[] = [];
  let adjustments: AdjustmentRow[] = [];
  const cache = new Map<string, CacheRow & { bodyHash: string | null }>();
  const eventScores = new Map<string, EventScoresRow>();
  const teamStats = new Map<string, TeamStatsRow>();
  const queues = new Map<string, string[]>(); // `${roundId}|${playerId}` -> team keys in order
  const autodraft = new Map<string, boolean>();
  const qk = (roundId: string, playerId: string) => `${roundId}|${playerId}`;
  /** Like `on delete cascade` from draft_queue/draft_prefs to rounds and players. */
  function dropDraftPrefs(matches: (roundId: string, playerId: string) => boolean) {
    for (const map of [queues, autodraft]) {
      for (const key of [...map.keys()]) {
        const [roundId, playerId] = key.split('|');
        if (matches(roundId, playerId)) map.delete(key);
      }
    }
  }

  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 0, 1) + tick++ * 1000).toISOString();
  const copy = <T>(v: T): T => structuredClone(v);
  /** Like the real database: a patch only touches the fields it actually names. */
  const defined = <T extends object>(patch: T): Partial<T> =>
    Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;

  function find<T extends { id: string }>(rows: T[], id: string, what: string): T {
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error(`${what} ${id} not found`);
    return row;
  }

  function dropRounds(ids: string[]) {
    rounds = rounds.filter((r) => !ids.includes(r.id));
    picks = picks.filter((p) => !ids.includes(p.roundId));
    adjustments = adjustments.filter((a) => !ids.includes(a.roundId));
    extraTeams = extraTeams.filter((t) => !ids.includes(t.roundId));
    dropDraftPrefs((roundId) => ids.includes(roundId));
  }

  return {
    async createLeague(input) {
      if (leagues.some((l) => l.slug === input.slug)) throw new UniqueViolation('leagues_slug_key');
      const row: LeagueRow = {
        id: randomUUID(),
        slug: input.slug,
        name: input.name,
        defaultScoring: copy(input.defaultScoring),
        adminTokenHash: input.adminTokenHash ?? null,
        homeTeamNumber: 5181,
        inviteCode: generateInviteCode(),
        visibility: input.visibility ?? 'link',
        createdBy: input.createdBy ?? null,
        createdAt: stamp(),
      };
      leagues.push(row);
      return copy(row);
    },
    async getLeagueBySlug(slug) {
      return copy(leagues.find((l) => l.slug === slug) ?? null);
    },
    async updateLeague(id, patch) {
      const row = find(leagues, id, 'league');
      Object.assign(row, defined(copy(patch)));
      return copy(row);
    },
    async deleteLeague(id) {
      dropRounds(rounds.filter((r) => r.leagueId === id).map((r) => r.id));
      players = players.filter((p) => p.leagueId !== id);
      leagues = leagues.filter((l) => l.id !== id);
    },
    async getLeagueByInviteCode(code) {
      return copy(leagues.find((l) => l.inviteCode === code) ?? null);
    },
    async resetInviteCode(leagueId) {
      const row = find(leagues, leagueId, 'league');
      for (let attempt = 0; attempt < 3; attempt++) {
        const code = generateInviteCode();
        if (code !== row.inviteCode && !leagues.some((l) => l.inviteCode === code)) {
          row.inviteCode = code;
          return copy(row);
        }
      }
      throw new UniqueViolation('leagues_invite_code_key');
    },
    async countLeaguesCreatedBy(userId) {
      return leagues.filter((l) => l.createdBy === userId).length;
    },
    async listLeaguesForUser(userId) {
      return copy(
        players
          .filter((p) => p.userId === userId)
          .map((player) => ({ league: find(leagues, player.leagueId, 'league'), player }))
          .sort((a, b) => a.league.createdAt.localeCompare(b.league.createdAt)),
      );
    },

    async listPlayers(leagueId) {
      return copy(players.filter((p) => p.leagueId === leagueId));
    },
    async createPlayer(leagueId, name) {
      if (players.some((p) => p.leagueId === leagueId && p.name.toLowerCase() === name.toLowerCase())) {
        throw new UniqueViolation('players_league_name_ci');
      }
      const row: PlayerRow = { id: randomUUID(), leagueId, name, userId: null, role: 'player', createdAt: stamp() };
      players.push(row);
      return copy(row);
    },
    async renamePlayer(id, name) {
      const row = find(players, id, 'player');
      const clash = players.some(
        (p) => p.id !== id && p.leagueId === row.leagueId && p.name.toLowerCase() === name.toLowerCase(),
      );
      if (clash) throw new UniqueViolation('players_league_name_ci');
      row.name = name;
      return copy(row);
    },
    async deletePlayer(id) {
      players = players.filter((p) => p.id !== id);
      picks = picks.filter((p) => p.playerId !== id);
      adjustments = adjustments.filter((a) => a.playerId !== id);
      dropDraftPrefs((_, playerId) => playerId === id);
    },

    async createMember(input) {
      if (players.some((p) => p.leagueId === input.leagueId && p.userId === input.userId)) {
        throw new UniqueViolation('players_league_user');
      }
      if (players.some((p) => p.leagueId === input.leagueId && p.name.toLowerCase() === input.name.toLowerCase())) {
        throw new UniqueViolation('players_league_name_ci');
      }
      const row: PlayerRow = { id: randomUUID(), createdAt: stamp(), ...input };
      players.push(row);
      return copy(row);
    },
    async getMemberByUser(leagueId, userId) {
      return copy(players.find((p) => p.leagueId === leagueId && p.userId === userId) ?? null);
    },
    async updatePlayer(id, patch) {
      const row = find(players, id, 'player');
      if (patch.name !== undefined) {
        const clash = players.some(
          (p) => p.id !== id && p.leagueId === row.leagueId && p.name.toLowerCase() === patch.name!.toLowerCase(),
        );
        if (clash) throw new UniqueViolation('players_league_name_ci');
      }
      Object.assign(row, defined(copy(patch)));
      return copy(row);
    },

    async getProfile(id) {
      return copy(profiles.find((p) => p.id === id) ?? null);
    },
    async createProfile(input) {
      const existing = profiles.find((p) => p.id === input.id);
      if (existing) return copy(existing);
      const row: ProfileRow = { ...input, frcTeam: null, createdAt: stamp() };
      profiles.push(row);
      return copy(row);
    },
    async updateProfile(id, patch) {
      const row = find(profiles, id, 'profile');
      Object.assign(row, defined(copy(patch)));
      return copy(row);
    },
    async deleteUser(id) {
      profiles = profiles.filter((p) => p.id !== id);
      for (const p of players) if (p.userId === id) p.userId = null;
      for (const l of leagues) if (l.createdBy === id) l.createdBy = null;
    },

    async listRounds(leagueId) {
      return copy(
        rounds
          .filter((r) => r.leagueId === leagueId)
          .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.createdAt.localeCompare(b.createdAt)),
      );
    },
    async getRound(id) {
      return copy(rounds.find((r) => r.id === id) ?? null);
    },
    async createRound(input) {
      if (rounds.some((r) => r.leagueId === input.leagueId && r.eventKey === input.eventKey)) {
        throw new UniqueViolation('rounds_league_event_key');
      }
      const row: RoundRow = {
        id: randomUUID(),
        rosterSize: 4,
        draftOrder: [],
        finalizedAt: null,
        draftMode: 'commissioner',
        pickSeconds: null,
        draftStartedAt: null,
        draftPausedAt: null,
        pausedRemainingMs: null,
        pickDeadline: null,
        createdAt: stamp(),
        ...copy(input),
      };
      rounds.push(row);
      return copy(row);
    },
    async updateRound(id, patch) {
      const row = find(rounds, id, 'round');
      Object.assign(row, defined(copy(patch)));
      return copy(row);
    },
    async deleteRound(id) {
      dropRounds([id]);
    },

    async listExtraTeams(roundId) {
      return extraTeams.filter((t) => t.roundId === roundId).map((t) => t.teamKey);
    },
    async addExtraTeam(roundId, teamKey) {
      if (!extraTeams.some((t) => t.roundId === roundId && t.teamKey === teamKey)) {
        extraTeams.push({ roundId, teamKey });
      }
    },
    async removeExtraTeam(roundId, teamKey) {
      extraTeams = extraTeams.filter((t) => !(t.roundId === roundId && t.teamKey === teamKey));
    },

    async listPicks(roundId) {
      return copy(picks.filter((p) => p.roundId === roundId).sort((a, b) => a.pickNumber - b.pickNumber));
    },
    async listPicksForRounds(roundIds) {
      return copy(
        picks.filter((p) => roundIds.includes(p.roundId)).sort((a, b) => a.pickNumber - b.pickNumber),
      );
    },
    async insertPick(input) {
      const inRound = picks.filter((p) => p.roundId === input.roundId);
      if (inRound.some((p) => p.pickNumber === input.pickNumber)) {
        throw new UniqueViolation('picks_round_pick_number_key');
      }
      if (inRound.some((p) => p.teamKey === input.teamKey)) throw new UniqueViolation('picks_round_team_key');
      const row: PickRow = { id: randomUUID(), createdAt: stamp(), ...input, auto: input.auto ?? false };
      picks.push(row);
      return copy(row);
    },
    async deletePick(roundId, pickNumber) {
      picks = picks.filter((p) => !(p.roundId === roundId && p.pickNumber === pickNumber));
    },
    async updatePickTeam(roundId, pickNumber, teamKey) {
      const row = picks.find((p) => p.roundId === roundId && p.pickNumber === pickNumber);
      if (!row) throw new Error(`pick ${pickNumber} not found`);
      const taken = picks.some((p) => p.roundId === roundId && p.id !== row.id && p.teamKey === teamKey);
      if (taken) throw new UniqueViolation('picks_round_team_key');
      row.teamKey = teamKey;
      return copy(row);
    },

    async listAdjustments(roundId) {
      return copy(adjustments.filter((a) => a.roundId === roundId));
    },
    async listAdjustmentsForRounds(roundIds) {
      return copy(adjustments.filter((a) => roundIds.includes(a.roundId)));
    },
    async getAdjustment(id) {
      return copy(adjustments.find((a) => a.id === id) ?? null);
    },
    async insertAdjustment(input) {
      const row: AdjustmentRow = { id: randomUUID(), createdAt: stamp(), ...input };
      adjustments.push(row);
      return copy(row);
    },
    async updateAdjustment(id, patch) {
      const row = find(adjustments, id, 'adjustment');
      Object.assign(row, defined(patch));
      return copy(row);
    },
    async deleteAdjustment(id) {
      adjustments = adjustments.filter((a) => a.id !== id);
    },

    async getCache(path) {
      const hit = cache.get(path);
      if (!hit) return null;
      const { bodyHash: _hash, ...row } = hit;
      return copy(row);
    },
    async upsertCache(row) {
      // Like the real repo: the hash is computed here, never passed in (spec §5.6).
      cache.set(row.path, { ...copy(row), bodyHash: bodyHash(row.body) });
    },
    async getCacheMeta(paths) {
      const out: CacheMeta[] = [];
      for (const path of paths) {
        const hit = cache.get(path);
        if (hit) {
          out.push({ path, fetchedAt: hit.fetchedAt, bodyHash: hit.bodyHash, lastErrorAt: hit.lastErrorAt });
        }
      }
      return out;
    },

    // Emulations of the 0003 SQL functions. Each body is one synchronous block (no `await`), so,
    // like the real `select ... for update`, two calls can never interleave. Like the SQL, they
    // return false instead of throwing; `dbNow()` plays the database's now().
    async makePickAtomic(input) {
      const r = rounds.find((x) => x.id === input.roundId);
      if (!r) return false;
      if (r.draftMode !== 'live' || !r.draftStartedAt || r.draftPausedAt) return false;
      const total = totalPicks(r);
      const inRound = picks.filter((p) => p.roundId === r.id);
      const n = inRound.length;
      if (n >= total || n !== input.pickNumber) return false;
      const nowMs = dbNow().getTime();
      if (input.requireDue && (!r.pickDeadline || nowMs < Date.parse(r.pickDeadline))) return false;
      // The SQL catches unique_violation: the slot is filled or the team is taken.
      if (inRound.some((p) => p.pickNumber === input.pickNumber || p.teamKey === input.teamKey)) return false;
      picks.push({
        id: randomUUID(), createdAt: stamp(), roundId: r.id, pickNumber: input.pickNumber,
        playerId: input.playerId, teamKey: input.teamKey, auto: input.auto,
      });
      r.pickDeadline = nextDeadline(r.pickSeconds, n + 1, total, nowMs);
      return true;
    },
    async undoPickAtomic(roundId, pickNumber) {
      const r = rounds.find((x) => x.id === roundId);
      if (!r) return false;
      const n = picks.filter((p) => p.roundId === roundId).length;
      if (n === 0 || pickNumber !== n - 1) return false;
      picks = picks.filter((p) => !(p.roundId === roundId && p.pickNumber === pickNumber));
      const paused = r.draftPausedAt !== null;
      // nextDeadline(s, 0, 1, now) is "a fresh full timer": 0 picks made of 1 remaining.
      r.pickDeadline =
        r.pickSeconds === null || !r.draftStartedAt || paused
          ? null
          : nextDeadline(r.pickSeconds, 0, 1, dbNow().getTime());
      // Paused with a timer: the undone player gets a full timer on resume.
      if (paused && r.pickSeconds !== null) r.pausedRemainingMs = r.pickSeconds * 1000;
      return true;
    },
    async draftControl(roundId, action) {
      const r = rounds.find((x) => x.id === roundId);
      if (!r) return false;
      const nowMs = dbNow().getTime();
      const nowIso = new Date(nowMs).toISOString();
      if (action === 'start') {
        if (r.draftMode !== 'live' || r.draftStartedAt) return false;
        r.draftStartedAt = nowIso;
        r.draftPausedAt = null;
        r.pausedRemainingMs = null;
        r.pickDeadline = nextDeadline(r.pickSeconds, 0, 1, nowMs);
        return true;
      }
      if (action === 'pause') {
        if (!r.draftStartedAt || r.draftPausedAt) return false;
        r.draftPausedAt = nowIso;
        r.pausedRemainingMs = pausedRemainingMs(r.pickDeadline, nowMs);
        r.pickDeadline = null;
        return true;
      }
      if (action === 'resume') {
        if (!r.draftPausedAt) return false;
        const n = picks.filter((p) => p.roundId === roundId).length;
        r.draftPausedAt = null;
        // Never a deadline on a finished draft.
        r.pickDeadline = n >= totalPicks(r) ? null : resumeDeadline(r.pickSeconds, r.pausedRemainingMs, nowMs);
        return true;
      }
      return false;
    },
    async getQueue(roundId, playerId) {
      return [...(queues.get(qk(roundId, playerId)) ?? [])];
    },
    async setQueue(roundId, playerId, teamKeys) {
      queues.set(qk(roundId, playerId), [...teamKeys]);
    },
    async getAutodraft(roundId, playerId) {
      return autodraft.get(qk(roundId, playerId)) ?? false;
    },
    async setAutodraft(roundId, playerId, on) {
      autodraft.set(qk(roundId, playerId), on);
    },
    async listAutodraftPlayers(roundId) {
      return [...autodraft.entries()]
        .filter(([key, on]) => on && key.startsWith(`${roundId}|`))
        .map(([key]) => key.split('|')[1]);
    },
    async getEventScoresRow(eventKey, configHash) {
      return copy(eventScores.get(`${eventKey}|${configHash}`) ?? null);
    },
    async upsertEventScoresRow(row) {
      eventScores.set(`${row.eventKey}|${row.configHash}`, copy(row));
    },
    async clearEventScores() {
      const n = eventScores.size;
      eventScores.clear();
      return n;
    },
    async getTeamStats(teamKeys, seasons, opts = {}) {
      const out: TeamStatsRow[] = [];
      for (const row of teamStats.values()) {
        if (!teamKeys.includes(row.teamKey) || !seasons.includes(row.season)) continue;
        out.push(opts.withHistory ? copy(row) : { ...copy(row), awards: [], events: [] });
      }
      return out;
    },
    async upsertTeamStats(rows) {
      for (const row of rows) teamStats.set(`${row.teamKey}|${row.season}`, copy(row));
    },
    async rlsDisabledTables() {
      return [];
    },
  };
}
