import { JoinButton } from '@/components/JoinButton';
import { SignInForm } from '@/components/SignInForm';
import { Card } from '@/components/ui/Card';
import type { InvitePreview } from '@/lib/api/types';
import { BAD_CODE_MESSAGE } from '@/lib/leagues/inviteMessages';

/** /join/{code} (spec §4.6). Signed out: name + sign in. Signed in: details + Join. */
export function JoinView({ preview, signedIn, code }: { preview: InvitePreview | null; signedIn: boolean; code: string }) {
  if (!preview) {
    return (
      <main id="main">
        <Card title="Invite code not found">
          <p className="text-[15px] text-fg-muted">{BAD_CODE_MESSAGE}</p>
        </Card>
      </main>
    );
  }
  return (
    <main id="main">
      <Card eyebrow="You're invited to" title={preview.name} className="space-y-4">
        {!signedIn ? (
          <>
            <p className="text-[15px] text-fg-muted">Sign in or create an account to join.</p>
            <SignInForm next={`/join/${code}`} />
          </>
        ) : preview.full ? (
          <p className="text-[15px] font-semibold text-red-alliance-text">League is full</p>
        ) : (
          <>
            <p className="text-[15px] text-fg-muted">
              {preview.commissioner ? `Commissioner: ${preview.commissioner} · ` : ''}
              {preview.memberCount} {preview.memberCount === 1 ? 'member' : 'members'}
            </p>
            <JoinButton code={code} />
          </>
        )}
      </Card>
    </main>
  );
}
