import { addDays } from '@/lib/rounds/status';
import type { EventSimple } from '@/lib/tba/types';
import { EVENT_KEY_RE } from '@/lib/teams';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Preseason and unlabeled events are never auto-added. Offseason (99) is: Ramp Riot is one. */
const NEVER = new Set([100, -1]);

/** Pure: which of a followed team's events become new rounds (spec §5.4 step 2). */
export function pickFollowEvents(
  events: EventSimple[],
  opts: { today: string; existing: Set<string>; skipped: Set<string> },
): EventSimple[] {
  const cutoff = addDays(opts.today, -1);
  const seen = new Set<string>();
  const out: EventSimple[] = [];
  for (const e of events) {
    if (!e || !EVENT_KEY_RE.test(e.key ?? '') || !DATE_RE.test(e.start_date ?? '') || !DATE_RE.test(e.end_date ?? '')) {
      continue;
    }
    if (NEVER.has(e.event_type) || e.end_date < cutoff) continue;
    if (opts.existing.has(e.key) || opts.skipped.has(e.key) || seen.has(e.key)) continue;
    seen.add(e.key);
    out.push(e);
  }
  return out.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.key.localeCompare(b.key));
}
