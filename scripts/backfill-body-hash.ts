// One-time, after migration 0004: fills tba_cache.body_hash for rows written before the column existed.
// Usage: npx tsx --env-file=.env.local scripts/backfill-body-hash.ts
import { createSupabaseClient } from '@/lib/db/supabaseRepo';
import { bodyHash } from '@/lib/scores/hash';

async function main() {
  const db = createSupabaseClient();
  let done = 0;
  for (;;) {
    const { data, error } = await db.from('tba_cache').select('path, body').is('body_hash', null).not('body', 'is', null).limit(200);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const { error: upErr } = await db.from('tba_cache').update({ body_hash: bodyHash(row.body) }).eq('path', row.path);
      if (upErr) throw new Error(upErr.message);
      done += 1;
    }
    console.log(`hashed ${done} rows so far`);
  }
  console.log(`Done: ${done} rows hashed. Rows with no body keep body_hash = null.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
