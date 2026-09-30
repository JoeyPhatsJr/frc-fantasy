'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { createLeague } from '@/lib/admin/client';

export function CreateLeagueForm() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { slug } = await createLeague({ name });
      window.location.assign('/l/' + slug + '/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
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
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Button type="submit" variant="accent" busy={busy} className="w-full">
          {busy ? 'Creating…' : 'Create league'}
        </Button>
      </form>
    </Card>
  );
}
