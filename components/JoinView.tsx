import { JoinButton } from '@/components/JoinButton';
import { SignInForm } from '@/components/SignInForm';
import { Card } from '@/components/ui/Card';
import type { InvitePreview } from '@/lib/api/types';
import type { LeagueFormat } from '@/lib/db/types';
import { shortDate } from '@/lib/format';
import { BAD_CODE_MESSAGE } from '@/lib/leagues/inviteMessages';

/** One plain-language line about the league, shown on the invite card (spec §4.6). */
export function joinDescription(
  league: { format: LeagueFormat; seasonYear?: number | null },
  next: { eventName: string; startDate: string } | null,
): string {
  if (league.format === 'season') return league.seasonYear ? `Full ${league.seasonYear} season` : 'Full season';
  return next ? `Event by event · next up ${next.eventName}, ${shortDate(next.startDate)}` : 'Event by event · no events yet';
}

/** /join/{code} (spec §4.6). Signed out: name + sign in. Signed in: details + Join. */
export function JoinView({
  preview,
  signedIn,
  code,
  description,
}: {
  preview: InvitePreview | null;
  signedIn: boolean;
  code: string;
  description?: string;
}) {
  if (!preview) {
    return (
      <main id="main">
        <Card title="Invite code not found">
          <p className="text-[15px] text-fg-muted">{BAD_CODE_MESSAGE}</p>
        </Card>
      </main>
    );
  }
  const players = `${preview.memberCount} ${preview.memberCount === 1 ? 'player' : 'players'}`;
  return (
    <main id="main" className="space-y-6 pt-2">
      <header className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-[.12em] text-fg-muted">You&apos;re invited to</p>
        <h1 className="text-balance font-display text-[34px] font-bold leading-[36px] tracking-[-0.01em] text-fg">{preview.name}</h1>
        {description ? <p className="text-[17px] leading-6 text-fg">{description}</p> : null}
        <p className="text-[15px] text-fg-muted">
          {preview.commissioner ? `Run by ${preview.commissioner} · ` : ''}
          {players}
        </p>
      </header>
      {!signedIn ? (
        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-[15px] text-fg-muted">Sign in or create an account to join.</p>
          <SignInForm next={`/join/${code}`} />
        </div>
      ) : preview.full ? (
        <p className="text-[15px] font-semibold text-red-alliance-text">League is full</p>
      ) : (
        <JoinButton code={code} />
      )}
    </main>
  );
}
