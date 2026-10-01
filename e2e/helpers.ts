import type { BrowserContext } from '@playwright/test';
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';
import { defaultScoring } from '@/lib/scoring/config';

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
export async function seedDraft(joeyId: string, momId: string) {
  const db = createSupabaseClient();
  const repo = createSupabaseRepo(db);
  const slug = `e2e-${Date.now().toString(36)}`;
  const inserted = await db.from('leagues').insert({ slug, name: 'E2E Draft', default_scoring: defaultScoring() }).select().single();
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

export async function cleanup(leagueId: string, userIds: string[]) {
  const db = createSupabaseClient();
  await db.from('leagues').delete().eq('id', leagueId);
  for (const id of userIds) await db.auth.admin.deleteUser(id);
}
