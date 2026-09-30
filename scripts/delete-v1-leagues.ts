// v2 spec §4.7: v1 only ever held demo/test leagues, so they are deleted before migration 0002.
// Dry run (lists them):   npx tsx --env-file=.env.local scripts/delete-v1-leagues.ts
// Delete (after Joey OKs the list):
//                         npx tsx --env-file=.env.local scripts/delete-v1-leagues.ts --confirm <count>
// <count> must equal the number listed, so a league created in between is never deleted by surprise.
// Cascades to players, rounds, picks, adjustments and extra teams. tba_cache is left alone.
import { createSupabaseClient } from '@/lib/db/supabaseRepo';

async function main() {
  const db = createSupabaseClient();
  const { data, error } = await db.from('leagues').select('id, slug, name, created_at').order('created_at');
  if (error) throw new Error(error.message);
  const leagues = data ?? [];

  console.log(`${leagues.length} league(s):`);
  for (const l of leagues) console.log(`  ${l.slug}  "${l.name}"  created ${String(l.created_at).slice(0, 10)}`);

  const i = process.argv.indexOf('--confirm');
  if (i === -1) {
    console.log(`\nDry run. To delete all of these, re-run with --confirm ${leagues.length}`);
    return;
  }
  const expected = Number(process.argv[i + 1]);
  if (expected !== leagues.length) {
    throw new Error(`--confirm ${process.argv[i + 1]} doesn't match the ${leagues.length} league(s) listed. Nothing deleted.`);
  }
  for (const l of leagues) {
    const del = await db.from('leagues').delete().eq('id', l.id);
    if (del.error) throw new Error(`${l.slug}: ${del.error.message}`);
    console.log(`deleted ${l.slug}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
