import { draftPhase, onClockPlayer } from '@/lib/draft/live';
import { localDate } from '@/lib/rounds/status';
import { targetRound } from '@/lib/rounds/target';
import { loadLeaguePage } from '@/lib/views/league';
import { listMyLeagues } from '@/lib/views/memberships';
import { leagueStatusLine, upNext, type UpNext, type UpNextInput } from '@/lib/views/upNext';

export type MeSeason = {
  total: number;
  bestPick: { teamKey: string; eventName: string; points: number } | null;
  averageFinish: number | null;
};

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

export type HomeLeague = { slug: string; name: string; isCommissioner: boolean; rank: number | null; total: number; line: string; error: boolean };
export type HomePage = { leagues: HomeLeague[]; upNext: UpNext; season: MeSeason };

/** Everything Home and You show. Leagues load in parallel; one failing league doesn't break the page. */
export async function loadHome(userId: string, now: Date): Promise<HomePage> {
  const memberships = await listMyLeagues(userId);
  const results = await Promise.allSettled(memberships.map((m) => loadLeaguePage(m.league.slug, now)));
  const today = localDate(now, 'America/New_York');
  const leagues: HomeLeague[] = [];
  const items: UpNextInput[] = [];
  const seasonRounds: SeasonInput[] = [];

  memberships.forEach(({ league, player }, i) => {
    const base = { slug: league.slug, name: league.name, isCommissioner: player.role === 'commissioner' };
    const result = results[i];
    if (result.status === 'rejected' || result.value === null) {
      if (result.status === 'rejected') console.error(result.reason);
      leagues.push({ ...base, rank: null, total: 0, line: "Couldn't load", error: true });
      return;
    }
    const page = result.value;
    const row = page.standings.find((s) => s.playerId === player.id);
    const targetId = targetRound(page.rounds.map((v) => ({ id: v.round.id, startDate: v.round.startDate, status: v.status })), today);
    const target = page.rounds.find((v) => v.round.id === targetId) ?? null;
    leagues.push({
      ...base,
      rank: row?.rank ?? null,
      total: row?.total ?? 0,
      line: leagueStatusLine(target && { eventName: target.round.eventName, status: target.status, startDate: target.round.startDate }),
      error: false,
    });
    for (const view of page.rounds) {
      const me = view.scores.find((s) => s.playerId === player.id) ?? null;
      const winner = view.scores.find((s) => s.rank === 1) ?? null;
      const phase = draftPhase(view.round, view.picks.length);
      items.push({
        leagueSlug: league.slug, leagueName: league.name,
        roundId: view.round.id, eventName: view.round.eventName,
        startDate: view.round.startDate, endDate: view.round.endDate,
        status: view.status, draftMode: view.round.draftMode,
        draftPhase: phase,
        myTurn: phase === 'live' && onClockPlayer(view.round, view.picks.length) === player.id,
        myRank: me?.rank ?? null, myPoints: me?.total ?? null,
        winnerName: winner?.name ?? null,
        myTeams: view.picks.filter((p) => p.playerId === player.id).sort((a, b) => a.pickNumber - b.pickNumber).map((p) => p.teamKey),
      });
      seasonRounds.push({
        eventName: view.round.eventName,
        startDate: view.round.startDate,
        finalized: view.round.finalizedAt !== null,
        me: me && { total: me.total, rank: me.rank, teams: me.teams.map((t) => ({ teamKey: t.teamKey, total: t.total })) },
      });
    }
  });
  return { leagues, upNext: upNext(items, today), season: seasonSummary(seasonRounds, today.slice(0, 4)) };
}
