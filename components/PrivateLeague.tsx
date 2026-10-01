import { SignInForm } from '@/components/SignInForm';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

/** Members-only league seen by a non-member (spec §4.5): explains itself, shows no data. */
export function PrivateLeague({ signedIn, next }: { signedIn: boolean; next: string }) {
  return (
    <main id="main">
      <Card title="Private league" className="space-y-4">
        <p className="text-[15px] text-fg-muted">Private league — ask the commissioner for an invite code.</p>
        {signedIn ? (
          <Button href="/leagues" variant="secondary">
            Enter an invite code
          </Button>
        ) : (
          <>
            <p className="text-[15px] text-fg-muted">Already a member? Sign in to see it.</p>
            <SignInForm next={next} />
          </>
        )}
      </Card>
    </main>
  );
}
