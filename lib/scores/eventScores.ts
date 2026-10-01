import { getRepo } from '@/lib/db';
import type { Repo } from '@/lib/db/repo';
import type { CacheMeta, EventScoresRow } from '@/lib/db/types';
import type { ScoringConfig } from '@/lib/scoring/config';
import { scoreEvent } from '@/lib/scoring/engine';
import type { EventScores } from '@/lib/scoring/types';
import { configHash, sourceStamp } from '@/lib/scores/hash';
import { deserializeEventScores, parseEventInfo, serializeEventScores } from '@/lib/scores/serialize';
import { cleanEventData, eventInfo, NO_EVENT_DATA, type EventInfo } from '@/lib/tba/clean';
import type { TbaDeps } from '@/lib/tba/client';
import { eventPaths, loadEventData } from '@/lib/tba/event';

export { deserializeEventScores, serializeEventScores } from '@/lib/scores/serialize';

export type EventScoresResult = {
  scores: EventScores;
  info: EventInfo;
  /** Same meaning as v1: true when TBA couldn't be refreshed and older data is shown. */
  stale: boolean;
  /** The oldest fetch among the six TBA paths: the honest "last updated". */
  fetchedAt: string | null;
};

export type EventScoresOptions = {
  now?: Date;
  /** Defaults to getRepo(); scripts and tests pass their own. Also used as the TBA cache store. */
  repo?: Repo;
  /** Passed through to getTba (fetch, clock, API key) — for scripts (throttling) and tests. */
  tba?: Partial<TbaDeps>;
};

function toMap(meta: CacheMeta[]): Map<string, CacheMeta> {
  return new Map(meta.map((m) => [m.path, m]));
}

function oldest(meta: CacheMeta[]): string | null {
  const times = meta.map((m) => m.fetchedAt).sort();
  return times[0] ?? null;
}

function fromRow(row: EventScoresRow | null): { scores: EventScores; info: EventInfo } | null {
  if (!row) return null;
  const scores = deserializeEventScores(row.scores);
  const info = parseEventInfo(row.info);
  return scores && info ? { scores, info } : null;
}

/**
 * Scores for one event under one scoring config, through the derived event_scores cache (spec §5.6).
 * A hit reads only tba_cache metadata and the stored row — no TBA bodies, no scoreEvent.
 * The cache is rebuildable: deleting every row only costs one re-score per event.
 */
export async function getEventScores(
  eventKey: string,
  config: ScoringConfig,
  windowMs: number,
  opts: EventScoresOptions = {},
): Promise<EventScoresResult> {
  const repo = opts.repo ?? getRepo();
  const now = opts.now ?? new Date();
  const paths = Object.values(eventPaths(eventKey)); // fixed order: the stamp depends on it
  const cfgHash = configHash(config);

  // Steps 2–3: metadata only.
  const [meta, stored] = await Promise.all([repo.getCacheMeta(paths), repo.getEventScoresRow(eventKey, cfgHash)]);
  const stamp = sourceStamp(paths, toMap(meta));
  const allFresh = meta.length === paths.length && meta.every((m) => now.getTime() - Date.parse(m.fetchedAt) < windowMs);
  if (stamp !== null && allFresh && stored?.sourceStamp === stamp) {
    const cached = fromRow(stored);
    if (cached) return { ...cached, stale: false, fetchedAt: oldest(meta) };
  }

  // Step 4: refresh through getTba exactly as v1 does (304s keep body_hash, so the stamp stays put).
  const loaded = await loadEventData(eventKey, { windowMs }, { store: repo, ...opts.tba });
  const data = cleanEventData(loaded.data);
  const info = eventInfo(data);
  const newStamp = sourceStamp(paths, toMap(await repo.getCacheMeta(paths)));

  if (newStamp !== null && stored?.sourceStamp === newStamp) {
    const cached = fromRow(stored);
    if (cached) return { scores: cached.scores, info, stale: loaded.stale, fetchedAt: loaded.fetchedAt };
  }

  let scores: EventScores;
  try {
    scores = scoreEvent(data, config);
  } catch (err) {
    // One malformed payload must not take a page down; the failure is not cached.
    console.error(`Scoring failed for ${eventKey}; falling back to empty data`, err);
    return { scores: scoreEvent(NO_EVENT_DATA, config), info, stale: true, fetchedAt: loaded.fetchedAt };
  }

  // No stamp = some path has never been cached (TBA never answered): don't cache a guess.
  if (newStamp !== null) {
    try {
      await repo.upsertEventScoresRow({
        eventKey,
        configHash: cfgHash,
        sourceStamp: newStamp,
        scores: serializeEventScores(scores),
        info,
        computedAt: now.toISOString(),
      });
    } catch (err) {
      // A cache write failure costs a re-score next time; it must not fail the page.
      console.error(`Could not cache scores for ${eventKey}`, err);
    }
  }
  return { scores, info, stale: loaded.stale, fetchedAt: loaded.fetchedAt };
}
