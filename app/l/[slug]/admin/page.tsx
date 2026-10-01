import type { Metadata } from 'next';
import { AdminDashboard } from '@/components/admin/AdminDashboard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Commissioner — FRC Fantasy',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ round_error?: string }> };

// A server component only so it can export `dynamic` and `metadata`; everything visible is the client
// component. The server never sees the token, because URL fragments are not sent to servers.
export default async function AdminPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { round_error } = await searchParams;
  return <AdminDashboard slug={slug} firstRoundFailed={round_error === '1'} />;
}
