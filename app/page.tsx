import { redirect } from 'next/navigation';
import { Landing } from '@/components/landing/Landing';
import { MeHome } from '@/components/me/MeHome';
import { safeNext } from '@/lib/auth/next';
import { getUser } from '@/lib/auth/session';
import { loadUpcomingEvents } from '@/lib/views/landing';
import { loadMePage } from '@/lib/views/me';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Props = { searchParams: Promise<{ auth_error?: string; next?: string }> };

export default async function HomePage({ searchParams }: Props) {
  const sp = await searchParams;
  const user = await getUser();
  if (user) {
    const next = safeNext(sp.next);
    if (next !== '/') redirect(next);
    return <MeHome page={await loadMePage(user.id, new Date())} />;
  }
  return <Landing upcoming={await loadUpcomingEvents(new Date())} authError={sp.auth_error === '1'} next={safeNext(sp.next)} />;
}
