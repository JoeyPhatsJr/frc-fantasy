// Creates a demo league that replays Ramp Riot 2025, with a finished draft.
// Usage: npx tsx --env-file=.env.local scripts/seed-demo.ts [site-url]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { generateAdminToken, hashToken, makeSlug } from '@/lib/auth/commissioner';
import { adminLink } from '@/lib/auth/rotate';
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';
import { defaultScoring } from '@/lib/scoring/config';
import { pickerFor } from '@/lib/scoring/round';
import type { TbaEvent, TeamSimple } from '@/lib/tba/types';
import { mergePool } from '@/lib/teams';

function fixture<T>(name: string): T {
  const file = path.join(process.cwd(), 'tests', 'fixtures', '2025parr', `${name}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

async function main() {
  const origin = (process.argv[2] ?? 'http://localhost:3000').replace(/\/+$/, '');
  const repo = createSupabaseRepo(createSupabaseClient());
  const event = fixture<TbaEvent>('event');
  const pool = mergePool(fixture<TeamSimple[]>('teams'), []);

  const token = generateAdminToken();
  const league = await repo.createLeague({
    slug: makeSlug('Demo Fam'),
    name: 'Demo Fam',
    adminTokenHash: hashToken(token),
    defaultScoring: defaultScoring(),
  });

  const players = [];
  for (const name of ['Joey', 'Mom', 'Dad', 'A Very Long Player Name To Test Wrapping']) {
    players.push(await repo.createPlayer(league.id, name));
  }

  const round = await repo.createRound({
    leagueId: league.id,
    eventKey: event.key,
    eventName: event.name,
    startDate: event.start_date,
    endDate: event.end_date,
    timezone: event.timezone || 'America/New_York',
    scoring: defaultScoring(),
  });
  const draftOrder = players.map((p) => p.id);
  const rosterSize = 4;
  await repo.updateRound(round.id, { draftOrder, rosterSize });

  // Spread picks across the pool so rosters are a mix of strong and weak teams.
  const step = Math.max(1, Math.floor(pool.length / (draftOrder.length * rosterSize)));
  for (let n = 0; n < draftOrder.length * rosterSize; n++) {
    await repo.insertPick({
      roundId: round.id,
      pickNumber: n,
      playerId: pickerFor(n, draftOrder),
      teamKey: pool[n * step].teamKey,
    });
  }
  await repo.insertAdjustment({
    roundId: round.id, playerId: players[1].id, teamKey: null, points: -5, reason: 'Late to the draft',
  });
  await repo.insertAdjustment({
    roundId: round.id, playerId: null, teamKey: pool[0].teamKey, points: 5, reason: 'Industrial Design Award',
  });

  console.log(`Public link: ${origin}/l/${league.slug}`);
  console.log(`Round page:  ${origin}/l/${league.slug}/r/${round.id}`);
  console.log(`Admin link:  ${adminLink(origin, league.slug, token)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
