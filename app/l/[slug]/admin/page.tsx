import type { Metadata } from 'next';
import { AdminDashboard } from '@/components/admin/AdminDashboard';
import { loadUpcomingEvents } from '@/lib/views/landing';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Commissioner — FRC Fantasy',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ round_error?: string }> };

// A server component so it can export `dynamic` and `metadata` and load the upcoming TBA events for the
// "Add an event" picker (public data, cached in tba_cache). Everything else is the client component,
// which checks the visitor is a commissioner before showing anything.
export default async function AdminPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { round_error } = await searchParams;
  // A TBA outage must never break admin: the picker just shows no upcoming events.
  const events = await loadUpcomingEvents(new Date()).catch(() => []);
  const upcoming = events.map((e) => ({ key: e.key, name: e.name, startDate: e.start_date, endDate: e.end_date }));
  return <AdminDashboard slug={slug} firstRoundFailed={round_error === '1'} upcoming={upcoming} />;
}
