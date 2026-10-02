'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Section } from '@/components/ui/Section';

/** Delete league (spec §4.4): typing the league name exactly enables the button. */
export function DangerZone({ leagueName, busy, onDelete }: { leagueName: string; busy: boolean; onDelete: (typed: string) => void }) {
  const [typed, setTyped] = useState('');
  return (
    <Section label="Danger zone">
      <div className="space-y-3 px-4 py-4">
        <p className="text-[15px] text-fg-muted">Deleting the league removes every round, pick and adjustment. It can&apos;t be undone.</p>
        <Input label={`Type ${leagueName} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        <Button type="button" variant="danger" disabled={busy || typed.trim() !== leagueName} onClick={() => onDelete(typed)}>
          Delete league
        </Button>
      </div>
    </Section>
  );
}
