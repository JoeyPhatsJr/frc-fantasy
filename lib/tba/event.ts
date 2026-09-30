import { getTba } from '@/lib/tba/client';
import type { EventData } from '@/lib/tba/types';

export function eventPaths(eventKey: string): Record<keyof EventData, string> {
  const base = `/event/${eventKey}`;
  return {
    teams: `${base}/teams/simple`,
    matches: `${base}/matches/simple`,
    rankings: `${base}/rankings`,
    alliances: `${base}/alliances`,
    awards: `${base}/awards`,
    oprs: `${base}/oprs`,
  };
}

export type LoadedEvent = { data: EventData; fetchedAt: string | null; stale: boolean };

/** Fetches everything the scoring engine needs for one event, in parallel. */
export async function loadEventData(
  eventKey: string,
  opts: { windowMs: number; force?: boolean },
): Promise<LoadedEvent> {
  const paths = eventPaths(eventKey);
  const names = Object.keys(paths) as (keyof EventData)[];
  const results = await Promise.all(names.map((name) => getTba<unknown>(paths[name], opts)));

  const data = Object.fromEntries(names.map((name, i) => [name, results[i].data])) as EventData;
  const times = results.map((r) => r.fetchedAt).filter((t): t is string => t !== null);
  return {
    data,
    // ISO timestamps sort correctly as strings. The oldest one is the honest "last updated".
    fetchedAt: times.length > 0 ? times.sort()[0] : null,
    stale: results.some((r) => r.stale),
  };
}
