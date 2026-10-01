// Runs a create / read / constraint / delete cycle against the real Supabase project.
// Usage: npx tsx --env-file=.env.local scripts/db-smoke.ts
import { UniqueViolation } from '@/lib/db/repo';
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';
import { defaultScoring } from '@/lib/scoring/config';
import { bodyHash } from '@/lib/scores/hash';

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
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is missing from .env.local (needed for the RLS checks)');
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

    check('duplicate slug is rejected',
      (await constraintOf(repo.createLeague({
        slug, name: 'x', adminTokenHash: 'h', defaultScoring: defaultScoring(),
      }))) === 'leagues_slug_key');

    await repo.addExtraTeam(round.id, 'frc9999');
    await repo.addExtraTeam(round.id, 'frc9999');
    check('extra team added twice keeps one copy',
      JSON.stringify(await repo.listExtraTeams(round.id)) === JSON.stringify(['frc9999']));
    await repo.removeExtraTeam(round.id, 'frc9999');
    check('extra team removes', (await repo.listExtraTeams(round.id)).length === 0);

    const adj = await repo.insertAdjustment({
      roundId: round.id, playerId: null, teamKey: 'frc341B', points: 3, reason: 'smoke',
    });
    const gotAdj = await repo.getAdjustment(adj.id);
    check('adjustment round-trips',
      gotAdj?.points === 3 && gotAdj.reason === 'smoke' && gotAdj.teamKey === 'frc341B' && gotAdj.playerId === null);
    const adjUpdated = await repo.updateAdjustment(adj.id, { points: 7 });
    check('adjustment patch keeps untouched fields',
      adjUpdated.points === 7 && adjUpdated.reason === 'smoke' && adjUpdated.teamKey === 'frc341B');
    check('adjustments list', (await repo.listAdjustments(round.id)).length === 1);
    check('adjustments list for rounds', (await repo.listAdjustmentsForRounds([round.id])).length === 1);

    check('pick team is replaceable', (await repo.updatePickTeam(round.id, 0, 'frc25')).teamKey === 'frc25');
    check('picks list for rounds', (await repo.listPicksForRounds([round.id])).length === 1);

    const renamed = await repo.updateLeague(league.id, { name: 'Smoke Test 2' });
    check('league patch keeps untouched fields',
      renamed.name === 'Smoke Test 2' && renamed.defaultScoring.qualWin === 3);

    check('null survives a round patch', (await repo.updateRound(round.id, { finalizedAt: null })).finalizedAt === null);

    const path = `/smoke/${slug}`;
    await repo.upsertCache({ path, etag: null, body: null, fetchedAt: new Date().toISOString(), lastError: null, lastErrorAt: null });
    check('cache stores a null body', (await repo.getCache(path))?.body === null);

    // v2 SP3 (migration 0004). Without it every round page errors, so fail loudly here first.
    const sp3 = createSupabaseClient();
    check('tba_cache.body_hash exists (0004 applied)', (await sp3.from('tba_cache').select('body_hash').limit(1)).error === null);
    check('event_scores table exists (0004 applied)', (await sp3.from('event_scores').select('event_key').limit(1)).error === null);
    check('team_stats table exists (0004 applied)', (await sp3.from('team_stats').select('team_key').limit(1)).error === null);
    const hashed = { smoke: [1, 2, 3] };
    await repo.upsertCache({ path, etag: null, body: hashed, fetchedAt: new Date().toISOString(), lastError: null, lastErrorAt: null });
    check('upsertCache writes body_hash', (await repo.getCacheMeta([path]))[0]?.bodyHash === bodyHash(hashed));
  } finally {
    await repo.deleteLeague(league.id);
  }
  // v2 SP1: accounts (spec §4). Needs a real auth user because profiles.id references auth.users.
  const db = createSupabaseClient();
  const email = `smoke-${Date.now().toString(36)}@example.com`;
  const created = await db.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
  const userId = created.data.user.id;
  let accountsLeagueId: string | null = null;
  try {
    const profile = await repo.createProfile({ id: userId, displayName: 'Smoke', avatarUrl: null });
    check('profile round-trips', profile.displayName === 'Smoke' && profile.frcTeam === null);
    check('createProfile twice returns the first row',
      (await repo.createProfile({ id: userId, displayName: 'Other', avatarUrl: null })).displayName === 'Smoke');

    const acc = await repo.createLeague({
      slug: `smoke-acc-${Date.now().toString(36)}`, name: 'Smoke Accounts', defaultScoring: defaultScoring(), createdBy: userId,
    });
    accountsLeagueId = acc.id;
    check('invite code comes from gen_invite_code()', /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(acc.inviteCode));
    check('visibility defaults to link, admin token is null', acc.visibility === 'link' && acc.adminTokenHash === null);
    check('lookup by invite code', (await repo.getLeagueByInviteCode(acc.inviteCode))?.id === acc.id);
    check('reset changes the code', (await repo.resetInviteCode(acc.id)).inviteCode !== acc.inviteCode);
    check('countLeaguesCreatedBy', (await repo.countLeaguesCreatedBy(userId)) === 1);

    const me = await repo.createMember({ leagueId: acc.id, userId, name: 'Smoke', role: 'commissioner' });
    check('one membership per user per league',
      (await constraintOf(repo.createMember({ leagueId: acc.id, userId, name: 'Smoke 2', role: 'player' }))) === 'players_league_user');
    check('listLeaguesForUser joins the league', (await repo.listLeaguesForUser(userId))[0]?.league.id === acc.id);
    check('unlink keeps the row', (await repo.updatePlayer(me.id, { userId: null })).userId === null);

    const code = await db.rpc('gen_invite_code');
    check('gen_invite_code is callable by the service role', typeof code.data === 'string');
  } finally {
    // Always clean up, even if a check threw; one failed cleanup must not skip the other.
    await repo.deleteUser(userId).catch((e) => { console.error('cleanup deleteUser failed', e); process.exitCode = 1; });
    if (accountsLeagueId) {
      await repo.deleteLeague(accountsLeagueId).catch((e) => { console.error('cleanup deleteLeague failed', e); process.exitCode = 1; });
    }
  }
  check('deleteUser removes the profile', (await repo.getProfile(userId)) === null);

  // RLS on, no policies (spec §8.1): the public anon key sees nothing and can't call our functions.
  const { createClient } = await import('@supabase/supabase-js');
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey);
  for (const table of ['leagues', 'players', 'profiles', 'rounds', 'picks', 'adjustments', 'tba_cache', 'event_scores', 'team_stats']) {
    const leaked = await anon.from(table).select('*').limit(1);
    check(`anon key reads no ${table}`, (leaked.data ?? []).length === 0);
  }
  check('anon key cannot call gen_invite_code', (await anon.rpc('gen_invite_code')).error !== null);

  check('league delete cascades', (await repo.getLeagueBySlug(slug)) === null);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
