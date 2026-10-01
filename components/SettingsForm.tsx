'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

/** /me/settings (spec §4.2): display name, "My FRC team", sign out, delete account. */
export function SettingsForm({ profile }: { profile: { displayName: string; frcTeam: number | null } }) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [team, setTeam] = useState(profile.frcTeam === null ? '' : String(profile.frcTeam));
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  async function call(method: string, url: string, body?: unknown) {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(typeof data.error === 'string' ? data.error : 'Something went wrong');
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy('save');
    setMessage(null);
    try {
      await call('PATCH', '/api/me/profile', {
        displayName,
        frcTeam: team.trim() === '' ? null : Number(team),
      });
      setMessage({ tone: 'success', text: 'Saved.' });
    } catch (err) {
      setMessage({ tone: 'danger', text: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    if (!window.confirm('Delete your account? Your past picks stay in league history under your name. This can’t be undone.')) return;
    setBusy('delete');
    try {
      await call('DELETE', '/api/me');
      window.location.assign('/');
    } catch (err) {
      setMessage({ tone: 'danger', text: err instanceof Error ? err.message : 'Something went wrong' });
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card title="Your profile" className="space-y-4">
        <form onSubmit={save} className="space-y-4">
          <Input label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} required />
          <Input
            label="My FRC team (optional)"
            inputMode="numeric"
            value={team}
            onChange={(e) => setTeam(e.target.value.replace(/\D/g, ''))}
            maxLength={5}
            hint="New leagues use your display name. To change your name in one league, open that league and use “You in this league”."
          />
          {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
          <Button type="submit" busy={busy === 'save'} disabled={busy !== null}>
            Save
          </Button>
        </form>
      </Card>
      <Card title="Account" className="space-y-3">
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
        <Button type="button" variant="danger" busy={busy === 'delete'} disabled={busy !== null} onClick={deleteAccount}>
          Delete account
        </Button>
      </Card>
    </div>
  );
}
