import { getRepo } from '@/lib/db';
import { addDays, cacheWindowFor, localDate } from '@/lib/rounds/status';
import { hasResult } from '@/lib/scoring/matches';
import { getTba } from '@/lib/tba/client';
import type { MatchSimple } from '@/lib/tba/types';
import { loadLeaguePage } from '@/lib/views/league';

export type MeLeague = {
  slug: string;
  name: string;
  isCommissioner: boolean;
  rank: number | null;
  total: number;
  anyLive: boolean;
  /** This league failed to load; its row says "Couldn't load" (spec §4.8). */
  error: boolean;
};
export type MeTeam = { teamKey: string; leagueName: string; eventName: string; label: string; status: 'live' | 'upcoming' };
export type MeSeason = {
  total: number;
  bestPick: { teamKey: string; eventName: string; points: number } | null;
  averageFinish: number | null;
};
export type MePage = { leagues: MeLeague[]; teams: MeTeam[]; season: MeSeason };

const LEVELS: Record<string, number> = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };
const order = (a: MatchSimple, b: MatchSimple) =>
  (LEVELS[a.comp_level] ?? 9) - (LEVELS[b.comp_level] ?? 9) || a.set_number - b.set_number || a.match_number - b.match_number;

export function matchLabel(m: MatchSimple): string {
  if (m.comp_level === 'qm') return `Q${m.match_number}`;
  if (m.comp_level === 'f') return `F${m.match_number}`;
  if (m.comp_level === 'sf' && m.match_number === 1) return `M${m.set_number}`; // double elimination (2023+)
  return `${m.comp_level.toUpperCase()}${m.set_number}-${m.match_number}`;
}

const plays = (m: MatchSimple, teamKey: string) =>
  Boolean(m.alliances?.red?.team_keys?.includes(teamKey) || m.alliances?.blue?.team_keys?.includes(teamKey));

/** "Q14 · up next" / "Q14 · in 2 matches" / "Quals done" / "Eliminated" / "Done" (spec §4.6). */
export function nextMatchLabel(teamKey: string, matches: MatchSimple[] | null): string {
  if (!matches || matches.length === 0) return 'Schedule not posted';
  const unplayed = matches.filter((m) => !hasResult(m)).sort(order);
  const i = unplayed.findIndex((m) => plays(m, teamKey));
  if (i === 0) return `${matchLabel(unplayed[0])} · up next`;
  if (i > 0) return `${matchLabel(unplayed[i])} · in ${i} ${i === 1 ? 'match' : 'matches'}`;
  if (unplayed.length === 0) return 'Done';
  return unplayed.some((m) => m.comp_level === 'qm') ? 'Quals done' : 'Eliminated';
}

export type SeasonInput = {
  eventName: string;
  startDate: string;
  finalized: boolean;
  me: { total: number; rank: number; teams: { teamKey: string; total: number }[] } | null;
};

/** "My season" (spec §4.6): calendar-year total, best single team-in-a-round, mean rank over finalized rounds. */
export function seasonSummary(rounds: SeasonInput[], year: string): MeSeason {
  const mine = rounds.filter((r) => r.me !== null && r.startDate.startsWith(year));
  let total = 0;
  let bestPick: MeSeason['bestPick'] = null;
  for (const r of mine) {
    total += r.me!.total;
    for (const t of r.me!.teams) {
      if (!bestPick || t.total > bestPick.points) bestPick = { teamKey: t.teamKey, eventName: r.eventName, points: t.total };
    }
  }
  const finals = mine.filter((r) => r.finalized);
  const averageFinish =
    finals.length === 0 ? null : Math.round((finals.reduce((s, r) => s + r.me!.rank, 0) / finals.length) * 10) / 10;
  return { total, bestPick, averageFinish };
}

/** Everything the Me tab shows. Leagues load in parallel; one failing league doesn't break the page. */
export async function loadMePage(userId: string, now: Date): Promise<MePage> {
  const memberships = await getRepo().listLeaguesForUser(userId);
  const results = await Promise.allSettled(memberships.map((m) => loadLeaguePage(m.league.slug, now)));

  const leagues: MeLeague[] = [];
  const teams: MeTeam[] = [];
  const seasonRounds: SeasonInput[] = [];
  const today = localDate(now, 'America/New_York');

  for (let i = 0; i < memberships.length; i++) {
    const { league, player } = memberships[i];
    const result = results[i];
    const base = { slug: league.slug, name: league.name, isCommissioner: player.role === 'commissioner' };
    if (result.status === 'rejected' || result.value === null) {
      if (result.status === 'rejected') console.error(result.reason);
      leagues.push({ ...base, rank: null, total: 0, anyLive: false, error: true });
      continue;
    }
    const page = result.value;
    const row = page.standings.find((s) => s.playerId === player.id);
    leagues.push({ ...base, rank: row?.rank ?? null, total: row?.total ?? 0, anyLive: page.anyLive, error: false });

    for (const view of page.rounds) {
      const me = view.scores.find((s) => s.playerId === player.id) ?? null;
      seasonRounds.push({
        eventName: view.round.eventName,
        startDate: view.round.startDate,
        finalized: view.round.finalizedAt !== null,
        me: me && { total: me.total, rank: me.rank, teams: me.teams.map((t) => ({ teamKey: t.teamKey, total: t.total })) },
      });

      const soon = view.status === 'upcoming' && view.round.startDate <= addDays(today, 7);
      if (view.status !== 'live' && !soon) continue;
      const myTeams = view.picks.filter((p) => p.playerId === player.id).map((p) => p.teamKey);
      if (myTeams.length === 0) continue;
      const matches = await getTba<MatchSimple[]>(`/event/${view.round.eventKey}/matches/simple`, {
        windowMs: cacheWindowFor(view.round, now),
      });
      for (const teamKey of myTeams) {
        teams.push({
          teamKey,
          leagueName: league.name,
          eventName: view.round.eventName,
          label: nextMatchLabel(teamKey, Array.isArray(matches.data) ? matches.data : null),
          status: view.status === 'live' ? 'live' : 'upcoming',
        });
      }
    }
  }
  return { leagues, teams, season: seasonSummary(seasonRounds, today.slice(0, 4)) };
}
