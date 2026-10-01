import { InviteCodeBox } from '@/components/InviteCodeBox';
import { LeagueRows } from '@/components/me/LeagueRows';
import { SignInCard } from '@/components/SignInCard';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { getUser } from '@/lib/auth/session';
import { loadMePage } from '@/lib/views/me';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export default async function LeaguesPage() {
  const user = await getUser();
  if (!user) return <SignInCard title="Sign in to see your leagues" next="/leagues" />;
  const { leagues } = await loadMePage(user.id, new Date());
  return (
    <main id="main" className="space-y-6">
      <h1 className="font-display text-[28px] font-bold leading-8 text-fg">Leagues</h1>
      <Card className="space-y-3">
        {leagues.length === 0 ? <p className="text-[15px] text-fg-muted">You&apos;re not in any leagues yet.</p> : null}
        <LeagueRows leagues={leagues} />
        <Button href="/leagues/new">Create league</Button>
      </Card>
      <Card>
        <InviteCodeBox />
      </Card>
    </main>
  );
}
