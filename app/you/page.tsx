import { AppearanceControl } from '@/components/you/AppearanceControl';
import { SettingsForm } from '@/components/SettingsForm';
import { SignInCard } from '@/components/SignInCard';
import { Section } from '@/components/ui/Section';
import { getUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function YouPage() {
  const user = await getUser();
  if (!user) return <SignInCard title="Sign in to see your profile" next="/you" />;
  const profile = await getRepo().getProfile(user.id);
  return (
    <main id="main" className="space-y-8">
      <h1 className="font-display text-[28px] font-bold leading-8 text-fg">You</h1>
      {/* "My season" is added in Task 9 once loadHome exists. */}
      <Section label="Appearance">
        <div className="px-4 py-3">
          <AppearanceControl />
        </div>
      </Section>
      <SettingsForm profile={{ displayName: profile?.displayName ?? 'Player', frcTeam: profile?.frcTeam ?? null }} />
    </main>
  );
}
