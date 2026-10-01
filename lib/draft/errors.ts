import { HttpError } from '@/lib/api/http';
import { getRepo } from '@/lib/db';
import { draftPhase } from '@/lib/draft/live';

/** Spec §7.3 live-draft 409s. The first and last messages match v1's wording. */
export const DRAFT_ERRORS = {
  stale: 'Draft changed in another tab — refresh',
  not_your_turn: "It's not your turn",
  not_live: "The draft isn't running right now",
  taken: 'That team was just taken',
} as const;
export type DraftErrorCode = keyof typeof DRAFT_ERRORS;

export function draftError(code: DraftErrorCode): HttpError {
  return new HttpError(409, DRAFT_ERRORS[code], code);
}

/** draft_make_pick only says "no". Look at the draft again to say why. */
export async function classifyFailedPick(roundId: string, teamKey: string): Promise<HttpError> {
  const repo = getRepo();
  const [round, picks] = await Promise.all([repo.getRound(roundId), repo.listPicks(roundId)]);
  if (picks.some((p) => p.teamKey === teamKey)) return draftError('taken');
  if (!round || draftPhase(round, picks.length) !== 'live') return draftError('not_live');
  return draftError('stale');
}
