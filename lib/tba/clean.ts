import type {
  Alliance,
  Award,
  EventData,
  MatchSimple,
  RankingRow,
  RankingsResponse,
  TeamSimple,
} from '@/lib/tba/types';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const objects = <T>(v: unknown): T[] | null => (Array.isArray(v) ? (v.filter(isObject) as T[]) : null);

export const NO_EVENT_DATA: EventData = {
  teams: null,
  matches: null,
  rankings: null,
  alliances: null,
  awards: null,
  oprs: null,
};

/** TBA is trusted but not blindly: a section (or row) with the wrong shape is treated as "no data". */
export function cleanEventData(data: EventData): EventData {
  const rankings: unknown = data.rankings;
  const oprs: unknown = data.oprs;
  const rankingRows = isObject(rankings) ? objects<RankingRow>(rankings.rankings) : null;
  return {
    teams: objects<TeamSimple>(data.teams),
    matches: objects<MatchSimple>(data.matches),
    rankings: isObject(rankings) && rankingRows ? { ...(rankings as RankingsResponse), rankings: rankingRows } : null,
    alliances: objects<Alliance>(data.alliances),
    awards: objects<Award>(data.awards),
    oprs: isObject(oprs) && isObject(oprs.oprs) ? (oprs as EventData['oprs']) : null,
  };
}

/** What the round page shows besides scores. Stored next to cached scores so a cache hit needs no TBA bodies. */
export type EventInfo = {
  /** teamKey -> nickname, for teams TBA knows about. */
  teamNames: Record<string, string>;
  /** False until TBA has at least one match or ranking for the event. */
  hasEventData: boolean;
  hasRankings: boolean;
};

/** Expects cleaned data (cleanEventData). */
export function eventInfo(data: EventData): EventInfo {
  const teamNames: Record<string, string> = {};
  for (const t of data.teams ?? []) if (t.nickname) teamNames[t.key] = t.nickname;
  const rankingCount = Array.isArray(data.rankings?.rankings) ? data.rankings.rankings.length : 0;
  return {
    teamNames,
    hasEventData: (data.matches?.length ?? 0) > 0 || rankingCount > 0,
    hasRankings: rankingCount > 0,
  };
}
