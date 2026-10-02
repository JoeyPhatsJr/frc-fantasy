import type { RoundStatus } from '@/lib/rounds/status';
import type { UpNext } from '@/lib/views/upNext';

/**
 * Spec §5.5: the live-draft pill and the league band render in layouts, and a layout only re-renders on a hard
 * load or router.refresh() (soft navigation reuses it). So pages a member may sit on while waiting for a live
 * draft to start refresh on this timer; AutoRefresh's router.refresh() re-renders the layouts too.
 */
export const DRAFT_WAIT_REFRESH_SECONDS = 30;

/** The live-draft pill can still change: a live-mode round is being set up or drafted. */
export function awaitingLiveDraft(rounds: { status: RoundStatus; draftMode: 'live' | 'commissioner' }[]): boolean {
  return rounds.some((r) => (r.status === 'setup' || r.status === 'drafting') && r.draftMode === 'live');
}

/** How often Home and Leagues re-render (seconds), or null to leave them alone. */
export function homeRefreshSeconds(next: UpNext): number | null {
  if (!next) return null;
  if (next.kind === 'draft-soon' && next.item.draftMode === 'live') return DRAFT_WAIT_REFRESH_SECONDS;
  if (next.kind === 'event-live' || next.kind === 'draft-live') return 60;
  return null;
}
