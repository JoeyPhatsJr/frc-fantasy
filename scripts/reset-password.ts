// Spec §4.1: no emails are ever sent, so the site admin resets forgotten passwords by hand.
// Usage: npx tsx --env-file=.env.local scripts/reset-password.ts <email> <new-password>
import { MIN_PASSWORD } from '@/lib/auth/passwordErrors';
import { createSupabaseClient } from '@/lib/db/supabaseRepo';

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) throw new Error('Usage: reset-password.ts <email> <new-password>');
  if (password.length < MIN_PASSWORD) throw new Error(`Passwords need at least ${MIN_PASSWORD} characters.`);
  const admin = createSupabaseClient().auth.admin;
  const wanted = email.trim().toLowerCase();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const user = data.users.find((u) => u.email?.toLowerCase() === wanted);
    if (user) {
      const upd = await admin.updateUserById(user.id, { password });
      if (upd.error) throw new Error(upd.error.message);
      console.log(`Password reset for ${user.email}. Give them the new password.`);
      return;
    }
    if (data.users.length < 200) break;
  }
  throw new Error(`No account with the email ${email}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
