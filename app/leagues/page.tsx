import { AutoRefresh } from '@/components/AutoRefresh';
import { InviteCodeBox } from '@/components/InviteCodeBox';
import { LeagueRows } from '@/components/me/LeagueRows';
import { SignInCard } from '@/components/SignInCard';
import { Button } from '@/components/ui/Button';
import { Section } from '@/components/ui/Section';
import { getUser } from '@/lib/auth/session';
import { loadHome } from '@/lib/views/home';
import { homeRefreshSeconds } from '@/lib/views/refresh';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export default async function LeaguesPage() {
  const user = await getUser();
  if (!user) return <SignInCard title="Sign in to see your leagues" next="/leagues" />;
  const { leagues, upNext } = await loadHome(user.id, new Date());
  // Same rule as Home: keeps the layout's live-draft pill current while a draft is about to start (spec §5.5).
  const refresh = homeRefreshSeconds(upNext);
  return (
    <main id="main" className="space-y-8">
      {refresh ? <AutoRefresh seconds={refresh} /> : null}
      <h1 className="font-display text-[28px] font-bold leading-8 text-fg">Leagues</h1>
      <Section label="Your leagues">
        {leagues.length === 0 ? <p className="px-4 py-3 text-[15px] text-fg-muted">You&apos;re not in any leagues yet.</p> : <LeagueRows leagues={leagues} />}
      </Section>
      <Button href="/leagues/new" className="w-full">Create a league</Button>
      <Section label="Join with a code">
        <div className="px-4 py-3">
          <InviteCodeBox />
        </div>
      </Section>
    </main>
  );
}
