import { redirect } from 'next/navigation';
import { Landing } from '@/components/landing/Landing';
import { AutoRefresh } from '@/components/AutoRefresh';
import { UpNextCard } from '@/components/home/UpNextCard';
import { InviteCodeBox } from '@/components/InviteCodeBox';
import { LeagueRows } from '@/components/me/LeagueRows';
import { Button } from '@/components/ui/Button';
import { Section } from '@/components/ui/Section';
import { safeNext } from '@/lib/auth/next';
import { getUser } from '@/lib/auth/session';
import { loadUpcomingEvents } from '@/lib/views/landing';
import { loadHome } from '@/lib/views/home';
import { homeRefreshSeconds } from '@/lib/views/refresh';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Props = { searchParams: Promise<{ auth_error?: string; next?: string }> };

export default async function HomePage({ searchParams }: Props) {
  const sp = await searchParams;
  const user = await getUser();
  if (user) {
    const next = safeNext(sp.next);
    if (next !== '/') redirect(next);
    const home = await loadHome(user.id, new Date());
    const refresh = homeRefreshSeconds(home.upNext);
    return (
      <main id="main" className="space-y-8">
        {refresh ? <AutoRefresh seconds={refresh} /> : null}
        {home.leagues.length === 0 ? (
          <div className="space-y-4 rounded-card border border-accent bg-surface p-4">
            <h1 className="font-display text-[28px] font-bold leading-8">Welcome!</h1>
            <p className="text-fg-muted">Join your family&apos;s league with the invite code, or start one.</p>
            <InviteCodeBox label="Have an invite code?" />
            <Button href="/leagues/new" variant="secondary" className="w-full">Create a league</Button>
          </div>
        ) : (
          <>
            <h1 className="sr-only">Home</h1>
            <UpNextCard next={home.upNext} />
            <Section label="Your leagues"><LeagueRows leagues={home.leagues} /></Section>
          </>
        )}
      </main>
    );
  }
  return <Landing upcoming={await loadUpcomingEvents(new Date())} authError={sp.auth_error === '1'} next={safeNext(sp.next)} />;
}
