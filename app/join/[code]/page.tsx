import { redirect } from 'next/navigation';
import { JoinView } from '@/components/JoinView';
import { HttpError } from '@/lib/api/http';
import type { InvitePreview } from '@/lib/api/types';
import { getUser } from '@/lib/auth/session';
import { buildInvitePreview, leagueForCode } from '@/lib/leagues/invites';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ code: string }> };

export default async function JoinPage({ params }: Props) {
  const { code } = await params;
  const user = await getUser();
  let preview: InvitePreview | null = null;
  try {
    preview = await buildInvitePreview(await leagueForCode(code), user?.id ?? null);
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 404)) throw err;
  }
  if (preview?.alreadyMember) redirect(`/l/${preview.slug}`);
  return <JoinView preview={preview} signedIn={user !== null} code={code.trim().toUpperCase()} />;
}
