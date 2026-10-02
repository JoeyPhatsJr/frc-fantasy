import { MySeason } from '@/components/you/MySeason';
import { AppearanceControl } from '@/components/you/AppearanceControl';
import { SettingsForm } from '@/components/SettingsForm';
import { SignInCard } from '@/components/SignInCard';
import { Section } from '@/components/ui/Section';
import { getUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';
import { localDate } from '@/lib/rounds/status';
import { loadHome, type HomePage } from '@/lib/views/home';

export const dynamic = 'force-dynamic';

export default async function YouPage() {
  const user = await getUser();
  if (!user) return <SignInCard title="Sign in to see your profile" next="/you" />;
  const now = new Date();
  let season: HomePage['season'] | null = null;
  try {
    season = (await loadHome(user.id, now)).season;
  } catch (e) {
    console.error(e); // My season is a nice-to-have: the rest of the page still works.
  }
  const profile = await getRepo().getProfile(user.id);
  return (
    <main id="main" className="space-y-8">
      <h1 className="font-display text-[28px] font-bold leading-8 text-fg">You</h1>
      {/* Spec §6.7 order: Profile · My season · Appearance · Account (the form owns the first and last). */}
      <SettingsForm profile={{ displayName: profile?.displayName ?? 'Player', frcTeam: profile?.frcTeam ?? null }}>
        {season ? (
          <Section label="My season">
            <MySeason season={season} year={localDate(now, 'America/New_York').slice(0, 4)} />
          </Section>
        ) : null}
        <Section label="Appearance">
          <div className="px-4 py-3">
            <AppearanceControl />
          </div>
        </Section>
      </SettingsForm>
    </main>
  );
}
