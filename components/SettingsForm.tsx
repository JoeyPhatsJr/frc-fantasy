'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Section } from '@/components/ui/Section';

/** The Profile and Account sections of /you: display name, "My FRC team", sign out, delete account. */
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
    <div className="space-y-8">
      <Section label="Profile">
        <form onSubmit={save} className="space-y-4 px-4 py-4">
          <Input
            label="Display name"
            name="displayName"
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={40}
            required
            hint="Shown in every league. You can also set a different name inside a league from its ⋯ menu."
          />
          <Input
            label="My FRC team (optional)"
            name="frcTeam"
            inputMode="numeric"
            autoComplete="off"
            value={team}
            onChange={(e) => setTeam(e.target.value.replace(/\D/g, ''))}
            maxLength={5}
          />
          {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
          <Button type="submit" busy={busy === 'save'} disabled={busy !== null}>
            Save
          </Button>
        </form>
      </Section>
      <Section label="Account">
        <div className="px-4 py-4">
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="secondary">
              Sign out
            </Button>
          </form>
          <div className="mt-8 border-t border-border pt-6">
            <Button type="button" variant="danger" busy={busy === 'delete'} disabled={busy !== null} onClick={deleteAccount}>
              Delete account
            </Button>
          </div>
        </div>
      </Section>
    </div>
  );
}
