'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

export function JoinButton({ code }: { code: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function join() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/invites/${encodeURIComponent(code)}/join`, { method: 'POST', credentials: 'same-origin' });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return router.push(`/l/${body.slug}`);
    setError(typeof body.error === 'string' ? body.error : 'Something went wrong');
    setBusy(false);
  }
  return (
    <div className="space-y-2">
      <Button type="button" busy={busy} onClick={join}>
        Join
      </Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
