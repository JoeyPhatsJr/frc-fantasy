'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Section } from '@/components/ui/Section';

type ShareNav = { share?: (d: ShareData) => Promise<void>; clipboard?: { writeText: (t: string) => Promise<void> } };

/** Opens the phone's share sheet when there is one; otherwise (or when it's cancelled) copies the link. */
export async function shareOrCopy(url: string, title: string, nav: ShareNav | undefined): Promise<'shared' | 'copied' | 'failed'> {
  if (nav?.share) {
    try {
      await nav.share({ url, title });
      return 'shared';
    } catch {
      // cancelled or blocked: try copying instead
    }
  }
  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(url);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  return 'failed';
}

const MESSAGES = {
  copied: 'Link copied',
  failed: "Couldn't share — copy the code instead",
} as const;

/** The top of the league admin page (spec §7.1): the invite code, Share link, and a small Reset code. */
export function InviteCard({
  leagueName,
  code,
  onReset,
  busy,
  resetting = false,
}: {
  leagueName: string;
  code: string;
  /** The dashboard asks for confirmation before it resets. */
  onReset: () => void;
  busy: boolean;
  resetting?: boolean;
}) {
  const [result, setResult] = useState<'shared' | 'copied' | 'failed' | null>(null);
  return (
    <Section label="Invite people">
      <div className="space-y-3 px-4 py-4">
        <p className="font-display text-[40px] font-bold leading-none tracking-[.12em] text-fg">{code}</p>
        <p className="text-[15px] text-fg-muted">Share this link, or tell people the code.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="primary"
            onClick={async () => {
              setResult(null);
              setResult(
                await shareOrCopy(`${window.location.origin}/join/${code}`, `Join ${leagueName}`, typeof navigator === 'undefined' ? undefined : navigator),
              );
            }}
          >
            Share link
          </Button>
          <Button type="button" variant="ghost" size="sm" busy={resetting} disabled={busy} onClick={onReset}>
            Reset code
          </Button>
        </div>
        <p aria-live="polite" className="text-sm font-medium text-fg-muted">
          {result === 'copied' || result === 'failed' ? MESSAGES[result] : null}
        </p>
      </div>
    </Section>
  );
}
