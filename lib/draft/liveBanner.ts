import { getUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';
import type { RoundRow } from '@/lib/db/types';
import { draftPhase } from '@/lib/draft/live';

export type LiveDraft = { roundId: string; eventName: string; phase: 'live' | 'paused' };

export function liveDraftsOf(views: { round: RoundRow; picks: unknown[] }[]): LiveDraft[] {
  return views.flatMap(({ round, picks }) => {
    const phase = draftPhase(round, picks.length);
    return phase === 'live' || phase === 'paused' ? [{ roundId: round.id, eventName: round.eventName, phase }] : [];
  });
}

/** Spec §7.6: signed-in members see a "Draft is live — join" banner. Everyone else sees nothing. */
export async function memberLiveDrafts(
  slug: string,
  views: { round: RoundRow; picks: unknown[] }[],
): Promise<LiveDraft[]> {
  const drafts = liveDraftsOf(views);
  if (drafts.length === 0) return [];
  const user = await getUser();
  if (!user) return [];
  const repo = getRepo();
  const league = await repo.getLeagueBySlug(slug);
  if (!league) return [];
  return (await repo.getMemberByUser(league.id, user.id)) ? drafts : [];
}
