import type { BrowserContext } from '@playwright/test';
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';
import { defaultScoring } from '@/lib/scoring/config';
import { pickerFor } from '@/lib/scoring/round';

export async function signIn(context: BrowserContext, email: string, name: string): Promise<string> {
  const secret = process.env.E2E_AUTH_SECRET;
  if (!secret) throw new Error('Set E2E_AUTH_SECRET in .env.local to run the E2E tests');
  const res = await context.request.post('/api/test/login', {
    headers: { authorization: `Bearer ${secret}` },
    data: { email, name },
  });
  if (!res.ok()) throw new Error(`test login failed: ${res.status()} ${await res.text()}`);
  return ((await res.json()) as { userId: string }).userId;
}

/** A league where Joey (commissioner) and Mom (player) have a live, not-yet-started Ramp Riot round. */
export async function seedDraft(joeyId: string, momId: string, name = 'E2E Draft') {
  const db = createSupabaseClient();
  const repo = createSupabaseRepo(db);
  const slug = `e2e-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const inserted = await db.from('leagues').insert({ slug, name, default_scoring: defaultScoring() }).select().single();
  if (inserted.error) throw new Error(inserted.error.message);
  const leagueId = inserted.data.id as string;
  const joey = await repo.createMember({ leagueId, userId: joeyId, name: 'Joey E2E', role: 'commissioner' });
  const mom = await repo.createMember({ leagueId, userId: momId, name: 'Mom E2E', role: 'player' });
  const round = await repo.createRound({
    leagueId, eventKey: '2025parr', eventName: 'Ramp Riot',
    startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York', scoring: defaultScoring(),
  });
  await repo.updateRound(round.id, { draftOrder: [joey.id, mom.id], rosterSize: 3, draftMode: 'live', pickSeconds: 30 });
  return { slug, leagueId, roundId: round.id };
}

/**
 * The same league, with the Ramp Riot draft already finished (picks entered by the commissioner), so the
 * Standings and Event tabs have scores. Snake order Joey, Mom, Mom, Joey, Joey, Mom over six teams
 * of the event.
 */
export async function seedFinishedDraft(joeyId: string, momId: string, name = 'E2E Scored') {
  const seed = await seedDraft(joeyId, momId, name);
  const repo = createSupabaseRepo(createSupabaseClient());
  await repo.updateRound(seed.roundId, { draftMode: 'commissioner' });
  const round = await repo.getRound(seed.roundId);
  if (!round) throw new Error('seeded round vanished');
  const teams = ['frc1218', 'frc2607', 'frc341', 'frc5181', 'frc1712', 'frc2539'];
  for (let n = 0; n < teams.length; n++) {
    await repo.insertPick({ roundId: seed.roundId, pickNumber: n, playerId: pickerFor(n, round.draftOrder), teamKey: teams[n] });
  }
  return seed;
}

export async function cleanup(leagueId: string, userIds: string[]) {
  const db = createSupabaseClient();
  await db.from('leagues').delete().eq('id', leagueId);
  for (const id of userIds) await db.auth.admin.deleteUser(id);
}
