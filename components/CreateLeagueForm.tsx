'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { adminFetch, createLeague } from '@/lib/admin/client';

type Visibility = 'link' | 'members';

/** /leagues/new (spec §4.6). With ?event=, the event becomes the first round. */
export function CreateLeagueForm({ event }: { event?: { key: string; name: string } }) {
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('link');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { slug } = await createLeague({ name, visibility });
      if (event) {
        try {
          await adminFetch(slug, '/rounds', { method: 'POST', body: { eventKey: event.key } });
        } catch {
          // The league exists; the commissioner can add the round from the dashboard.
        }
      }
      window.location.assign(`/l/${slug}/admin`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  const choice = (value: Visibility, label: string, hint: string) => (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border p-3 has-[:checked]:border-primary">
      <input
        type="radio"
        name="visibility"
        value={value}
        checked={visibility === value}
        onChange={() => setVisibility(value)}
        className="mt-1 size-4 accent-[var(--color-primary)]"
      />
      <span>
        <span className="block font-semibold text-fg">{label}</span>
        <span className="block text-sm text-fg-muted">{hint}</span>
      </span>
    </label>
  );

  return (
    <Card title="Create a league" className="space-y-4">
      <form onSubmit={submit} className="space-y-4">
        <Input label="League name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold text-fg">Who can see it?</legend>
          {choice('link', 'Anyone with the link can view', 'Standings are public to whoever has the link. Only members play.')}
          {choice('members', 'Members only', 'Only people who joined with the invite code can see it.')}
        </fieldset>
        {event ? <p className="text-[15px] text-fg-muted">First round: {event.name}</p> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Button type="submit" busy={busy} disabled={name.trim() === ''}>
          Create league
        </Button>
      </form>
    </Card>
  );
}
