// Runs a create / read / constraint / delete cycle against the real Supabase project.
// Usage: npx tsx --env-file=.env.local scripts/db-smoke.ts
import { UniqueViolation } from '@/lib/db/repo';
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';
import { defaultScoring } from '@/lib/scoring/config';

function check(label: string, ok: boolean) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!ok) process.exitCode = 1;
}

async function constraintOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (err) {
    if (err instanceof UniqueViolation) return err.constraint;
    throw err;
  }
}

async function main() {
  const repo = createSupabaseRepo(createSupabaseClient());
  const slug = `smoke-test-${Date.now().toString(36)}`;
  const league = await repo.createLeague({
    slug,
    name: 'Smoke Test',
    adminTokenHash: 'not-a-real-hash',
    defaultScoring: defaultScoring(),
  });
  try {
    check('league round-trips', (await repo.getLeagueBySlug(slug))?.defaultScoring.qualWin === 3);

    const mom = await repo.createPlayer(league.id, 'Mom');
    check('player name is case-insensitive unique',
      (await constraintOf(repo.createPlayer(league.id, 'mom'))) === 'players_league_name_ci');

    const round = await repo.createRound({
      leagueId: league.id, eventKey: '2025parr', eventName: 'Ramp Riot',
      startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
      scoring: defaultScoring(),
    });
    check('round defaults', round.rosterSize === 4 && round.draftOrder.length === 0 && round.finalizedAt === null);
    check('round dates are YYYY-MM-DD', round.startDate === '2025-10-25');
    check('same event twice is rejected',
      (await constraintOf(repo.createRound({
        leagueId: league.id, eventKey: '2025parr', eventName: 'x',
        startDate: '2025-10-25', endDate: '2025-10-25', timezone: 'America/New_York',
        scoring: defaultScoring(),
      }))) === 'rounds_league_event_key');

    const updated = await repo.updateRound(round.id, { draftOrder: [mom.id], rosterSize: 2 });
    check('draft order saves', updated.draftOrder[0] === mom.id && updated.rosterSize === 2);

    await repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc341B' });
    check('team taken is rejected',
      (await constraintOf(repo.insertPick({ roundId: round.id, pickNumber: 1, playerId: mom.id, teamKey: 'frc341B' }))) === 'picks_round_team_key');
    check('pick number taken is rejected',
      (await constraintOf(repo.insertPick({ roundId: round.id, pickNumber: 0, playerId: mom.id, teamKey: 'frc25' }))) === 'picks_round_pick_number_key');

    const path = `/smoke/${slug}`;
    await repo.upsertCache({ path, etag: null, body: null, fetchedAt: new Date().toISOString(), lastError: null, lastErrorAt: null });
    check('cache stores a null body', (await repo.getCache(path))?.body === null);
  } finally {
    await repo.deleteLeague(league.id);
  }
  check('league delete cascades', (await repo.getLeagueBySlug(slug)) === null);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
