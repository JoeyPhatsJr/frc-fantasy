import type { Metadata } from 'next';
import { AdminDashboard } from '@/components/admin/AdminDashboard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Commissioner — FRC Fantasy',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type Props = { params: Promise<{ slug: string }> };

// A server component only so it can export `dynamic` and `metadata`; everything visible is the client
// component. The server never sees the token, because URL fragments are not sent to servers.
export default async function AdminPage({ params }: Props) {
  const { slug } = await params;
  return <AdminDashboard slug={slug} />;
}
