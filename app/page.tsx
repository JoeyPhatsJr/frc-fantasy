import { redirect } from 'next/navigation';
import { Landing } from '@/components/landing/Landing';
import { safeNext } from '@/lib/auth/next';
import { getUser } from '@/lib/auth/session';
import { loadUpcomingEvents } from '@/lib/views/landing';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Props = { searchParams: Promise<{ auth_error?: string; next?: string }> };

export default async function HomePage({ searchParams }: Props) {
  const sp = await searchParams;
  const user = await getUser();
  // Task 17 replaces this signed-in branch with the Me tab.
  if (user) redirect(safeNext(sp.next) === '/' ? '/leagues' : safeNext(sp.next));
  return <Landing upcoming={await loadUpcomingEvents(new Date())} authError={sp.auth_error === '1'} next={safeNext(sp.next)} />;
}
