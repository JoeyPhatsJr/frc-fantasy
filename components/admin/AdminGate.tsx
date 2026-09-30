'use client';

import type { ReactNode } from 'react';
import { useAdmin } from '@/components/admin/useAdmin';
import { Alert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { RefreshCw } from '@/components/ui/icons';
import { FIELD_BASE } from '@/components/ui/Input';
import type { AdminApi } from '@/lib/admin/client';

// Class strings for admin controls that can't use the <Button>/<Input> primitives directly (Task 27
// uses them). They come from the primitives, so they always match: 44px tall, pill, focus ring.
export const BTN = buttonClass('secondary');
export const BTN_PRIMARY = buttonClass('primary');
export const BTN_DANGER = buttonClass('danger');
/** No width of its own: add `flex-1`, `w-full`, `w-20`... where it's used. */
export const INPUT = `${FIELD_BASE} min-w-0`;

const TITLE = 'break-words font-display text-[22px] font-bold leading-[26px] text-fg';

export function AdminGate({ slug, children }: { slug: string; children: (api: AdminApi) => ReactNode }) {
  const session = useAdmin(slug);

  if (session.status === 'checking') {
    return (
      <main id="main">
        <p role="status" className="flex min-h-11 items-center gap-3 text-fg-muted">
          <span
            aria-hidden="true"
            className="size-5 shrink-0 rounded-full border-2 border-primary border-r-transparent motion-safe:animate-spin"
          />
          Checking your admin link…
        </p>
      </main>
    );
  }
  if (session.status === 'invalid') {
    return (
      <main id="main">
        <Card className="space-y-3">
          <h1 className={TITLE}>This admin link is invalid</h1>
          <p className="text-[15px] text-fg-muted">
            Open the commissioner link from your group chat on this device. If it still doesn&apos;t work, the link
            may have been replaced; ask whoever runs the league for the new one.
          </p>
          <Button href={`/l/${slug}`} variant="secondary">
            View standings
          </Button>
        </Card>
      </main>
    );
  }
  if (session.status === 'error') {
    return (
      <main id="main">
        <Card className="space-y-4">
          <h1 className={TITLE}>Can&apos;t load the admin page</h1>
          <Alert tone="danger">{session.message}</Alert>
          <Button type="button" onClick={() => window.location.reload()}>
            <RefreshCw className="size-4 shrink-0" />
            Try again
          </Button>
        </Card>
      </main>
    );
  }
  return <>{children(session.api)}</>;
}
