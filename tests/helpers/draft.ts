import { randomUUID } from 'node:crypto';
import type { Repo } from '@/lib/db/repo';
import type { DraftMode, PickSeconds } from '@/lib/db/types';
import { defaultScoring } from '@/lib/scoring/config';
import { seedLeague } from './api';

export { TBA_TEAMS } from './draftMocks';

/** Draft night, 7 pm Eastern. */
export const T0 = new Date('2026-10-23T23:00:00.000Z');

/**
 * A league with Joey (commissioner, from SP1's seedLeague) and Mom (player), and a Ramp Riot round
 * with order [Joey, Mom], roster size 2, live mode, 60 s timer — unless opts say otherwise.
 */
export async function seedLiveDraft(
  repo: Repo,
  opts: { pickSeconds?: PickSeconds | null; rosterSize?: number; mode?: DraftMode; start?: boolean } = {},
) {
  const { league, commissioner: joey, user: joeyUser } = await seedLeague(repo);
  const momUser = { id: randomUUID(), email: 'mom@example.com' };
  const mom = await repo.createMember({ leagueId: league.id, userId: momUser.id, name: 'Mom', role: 'player' });
  const strangerUser = { id: randomUUID(), email: 'stranger@example.com' };
  const created = await repo.createRound({
    leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
  });
  let round = await repo.updateRound(created.id, {
    draftOrder: [joey.id, mom.id],
    rosterSize: opts.rosterSize ?? 2,
    draftMode: opts.mode ?? 'live',
    pickSeconds: opts.pickSeconds === undefined ? 60 : opts.pickSeconds,
  });
  if (opts.start) {
    await repo.draftControl(round.id, 'start');
    round = (await repo.getRound(round.id))!;
  }
  return { league, round, joey, joeyUser, mom, momUser, strangerUser };
}
