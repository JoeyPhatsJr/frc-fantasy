import { CreateLeagueForm } from '@/components/CreateLeagueForm';
import { SignInCard } from '@/components/SignInCard';
import { getUser } from '@/lib/auth/session';
import { DEFAULT_WINDOW_MS } from '@/lib/rounds/status';
import { getTba } from '@/lib/tba/client';
import type { TbaEvent } from '@/lib/tba/types';
import { EVENT_KEY_RE } from '@/lib/teams';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Props = { searchParams: Promise<{ event?: string | string[] }> };

export default async function NewLeaguePage({ searchParams }: Props) {
  const raw = (await searchParams).event;
  const key = typeof raw === 'string' && EVENT_KEY_RE.test(raw) ? raw : null;
  const user = await getUser();
  if (!user) return <SignInCard title="Sign in to create a league" next={key ? `/leagues/new?event=${key}` : '/leagues/new'} />;

  let event: { key: string; name: string } | undefined;
  if (key) {
    const tba = await getTba<TbaEvent>(`/event/${key}`, { windowMs: DEFAULT_WINDOW_MS });
    if (tba.data?.name) event = { key, name: tba.data.name };
  }
  return (
    <main id="main">
      <CreateLeagueForm event={event} />
    </main>
  );
}
