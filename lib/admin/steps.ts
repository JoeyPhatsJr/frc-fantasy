import type { RoundStatus } from '@/lib/rounds/status';

export type AdminStep = 1 | 2 | 3 | 4;

export const STEP_TITLE: Record<AdminStep, string> = { 1: 'Set up', 2: 'Run the draft', 3: 'During the event', 4: 'Wrap up' };

/** Setup is done when there is a roster size and every current player has a draft slot (spec §8.2). */
export function setupDone(round: { draftOrder: string[]; rosterSize: number }, playerIds: string[]): boolean {
  if (round.rosterSize <= 0 || round.draftOrder.length === 0) return false;
  const order = new Set(round.draftOrder);
  return playerIds.every((id) => order.has(id));
}

/** Which checklist step round admin opens on (spec §7.2). */
export function adminStep(status: RoundStatus, setupComplete: boolean): AdminStep {
  switch (status) {
    case 'setup':
      return setupComplete ? 2 : 1;
    case 'drafting':
      return 2;
    case 'upcoming':
    case 'live':
      return 3;
    case 'awaiting_final':
    case 'final':
      return 4;
  }
}

export function stepDone(step: AdminStep, current: AdminStep): boolean {
  return step < current;
}
