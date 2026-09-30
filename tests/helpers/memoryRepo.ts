import { randomUUID } from 'node:crypto';
import { UniqueViolation, type Repo } from '@/lib/db/repo';
import type {
  AdjustmentRow,
  CacheRow,
  LeagueRow,
  PickRow,
  PlayerRow,
  RoundRow,
} from '@/lib/db/types';

const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function newInviteCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += INVITE_ALPHABET[Math.floor(Math.random() * INVITE_ALPHABET.length)];
  return code;
}

/** A Repo that lives in memory and enforces the same unique constraints as the real schema. */
export function createMemoryRepo(): Repo {
  let leagues: LeagueRow[] = [];
  let players: PlayerRow[] = [];
  let rounds: RoundRow[] = [];
  let extraTeams: { roundId: string; teamKey: string }[] = [];
  let picks: PickRow[] = [];
  let adjustments: AdjustmentRow[] = [];
  const cache = new Map<string, CacheRow>();

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
        inviteCode: newInviteCode(),
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
      const row: PickRow = { id: randomUUID(), createdAt: stamp(), ...input };
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
      return copy(cache.get(path) ?? null);
    },
    async upsertCache(row) {
      cache.set(row.path, copy(row));
    },
  };
}
