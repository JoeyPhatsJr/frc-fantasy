import { SettingsForm } from '@/components/SettingsForm';
import { SignInCard } from '@/components/SignInCard';
import { getUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await getUser();
  if (!user) return <SignInCard title="Sign in to change your settings" next="/me/settings" />;
  const profile = await getRepo().getProfile(user.id);
  return (
    <main id="main" className="space-y-6">
      <h1 className="font-display text-[28px] font-bold leading-8 text-fg">Settings</h1>
      <SettingsForm profile={{ displayName: profile?.displayName ?? 'Player', frcTeam: profile?.frcTeam ?? null }} />
    </main>
  );
}
