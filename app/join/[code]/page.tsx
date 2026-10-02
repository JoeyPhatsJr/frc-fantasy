import { redirect } from 'next/navigation';
import { JoinView, joinDescription } from '@/components/JoinView';
import { HttpError } from '@/lib/api/http';
import type { InvitePreview } from '@/lib/api/types';
import { getUser } from '@/lib/auth/session';
import { getRepo } from '@/lib/db';
import { buildInvitePreview, leagueForCode } from '@/lib/leagues/invites';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ code: string }> };

export default async function JoinPage({ params }: Props) {
  const { code } = await params;
  const user = await getUser();
  let preview: InvitePreview | null = null;
  let description: string | undefined;
  try {
    const league = await leagueForCode(code);
    preview = await buildInvitePreview(league, user?.id ?? null);
    const rounds = await getRepo().listRounds(league.id);
    const today = new Date().toISOString().slice(0, 10);
    const next = rounds.filter((r) => r.startDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
    const seasonYear = rounds.filter((r) => r.kind === 'season').at(-1)?.seasonYear ?? null;
    description = joinDescription(
      { format: league.format, seasonYear },
      next ? { eventName: next.eventName, startDate: next.startDate } : null,
    );
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 404)) throw err;
  }
  if (preview?.alreadyMember) redirect(`/l/${preview.slug}`);
  return <JoinView preview={preview} signedIn={user !== null} code={code.trim().toUpperCase()} description={description} />;
}
