import Link from 'next/link';
import { InviteCodeBox } from '@/components/InviteCodeBox';
import { SignInCard } from '@/components/SignInCard';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { getUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function LeaguesPage() {
  const user = await getUser();
  if (!user) return <SignInCard title="Sign in to see your leagues" next="/leagues" />;
  const mine = await getRepo().listLeaguesForUser(user.id);
  return (
    <main id="main" className="space-y-6">
      <h1 className="font-display text-[28px] font-bold leading-8 text-fg">Leagues</h1>
      <Card className="space-y-3">
        {mine.length === 0 ? <p className="text-[15px] text-fg-muted">You&apos;re not in any leagues yet.</p> : null}
        <ul className="-mx-2 divide-y divide-border">
          {mine.map(({ league, player }) => (
            <li key={league.id}>
              <Link
                href={`/l/${league.slug}`}
                className="flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-lg px-2 hover:bg-fg/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 truncate font-semibold text-fg">{league.name}</span>
                {player.role === 'commissioner' ? (
                  <span className="shrink-0 text-sm font-semibold text-secondary">Commissioner</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
        <Button href="/leagues/new">Create league</Button>
      </Card>
      <Card>
        <InviteCodeBox />
      </Card>
    </main>
  );
}
