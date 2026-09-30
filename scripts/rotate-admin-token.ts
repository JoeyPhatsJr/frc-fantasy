// Makes a new admin link for a league when the old one is lost (spec §4).
// Usage: npx tsx --env-file=.env.local scripts/rotate-admin-token.ts <slug> [site-url]
import { adminLink, rotateAdminToken } from '@/lib/auth/rotate';
import { createSupabaseClient, createSupabaseRepo } from '@/lib/db/supabaseRepo';

async function main() {
  const slug = (process.argv[2] ?? '').trim();
  const origin = (process.argv[3] ?? 'http://localhost:3000').trim();
  if (!slug) {
    throw new Error('Usage: rotate-admin-token.ts <slug> [site-url]\n  e.g. rotate-admin-token.ts habich-fam-k3x9qd https://frc-fantasy.vercel.app');
  }
  const repo = createSupabaseRepo(createSupabaseClient());
  const out = await rotateAdminToken(repo, slug);
  console.log(`New admin link for "${out.name}":\n`);
  console.log(`  ${adminLink(origin, out.slug, out.token)}\n`);
  console.log('Save it now. The old admin link no longer works.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
