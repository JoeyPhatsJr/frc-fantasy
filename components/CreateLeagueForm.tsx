'use client';

import { useState } from 'react';
import { CopyButton } from '@/components/CopyButton';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { adminLinkFor, createLeague } from '@/lib/admin/client';

type Created = { publicLink: string; adminLink: string };

export function CreateLeagueForm() {
  const [name, setName] = useState('');
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { slug, adminToken } = await createLeague(name, passcode);
      const origin = window.location.origin;
      setCreated({ publicLink: `${origin}/l/${slug}`, adminLink: adminLinkFor(origin, slug, adminToken) });
      setPasscode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <Card title="League created" className="space-y-4">
        <Alert tone="danger">
          <div className="space-y-3">
            <p className="font-display text-lg font-bold uppercase tracking-wide text-fg">
              Save your admin link now.
            </p>
            <p className="font-normal text-fg">
              It is shown only this once and can&apos;t be recovered from the app. Anyone with this link can
              change the league, so don&apos;t post it in the group chat.
            </p>
            <p className="break-all rounded-lg border border-red-alliance/30 bg-surface p-2 font-mono text-xs text-fg">
              {created.adminLink}
            </p>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={created.adminLink} label="Copy admin link" />
              <Button href={created.adminLink}>Open admin page</Button>
            </div>
          </div>
        </Alert>

        <div className="space-y-3 rounded-xl border border-border bg-surface-2 p-3">
          <p className="font-semibold text-fg">Public link (for the group chat)</p>
          <p className="break-all rounded-lg border border-border bg-surface p-2 font-mono text-xs text-fg">
            {created.publicLink}
          </p>
          <CopyButton text={created.publicLink} label="Copy public link" />
        </div>
      </Card>
    );
  }

  return (
    <Card title="Create a league">
      <form onSubmit={submit} className="space-y-4">
        <Input
          label="League name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
          placeholder="Habich Fam"
        />
        <Input
          label="Site passcode"
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          maxLength={200}
          required
          autoComplete="off"
        />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Button type="submit" variant="accent" busy={busy} className="w-full">
          {busy ? 'Creating…' : 'Create league'}
        </Button>
      </form>
    </Card>
  );
}
