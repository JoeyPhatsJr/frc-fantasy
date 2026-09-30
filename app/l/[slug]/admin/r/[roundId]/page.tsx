import type { Metadata } from 'next';
import { RoundAdmin } from '@/components/admin/RoundAdmin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Round admin — FRC Fantasy',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type Props = { params: Promise<{ slug: string; roundId: string }> };

// A server component only so it can export `dynamic` and `metadata`; everything visible is the client
// component, which renders <main id="main">. The admin token lives in the URL fragment, never sent here.
export default async function RoundAdminPage({ params }: Props) {
  const { slug, roundId } = await params;
  return <RoundAdmin slug={slug} roundId={roundId} />;
}
