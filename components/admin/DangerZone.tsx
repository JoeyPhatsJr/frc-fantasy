'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

/** Delete league (spec §4.4): typing the league name exactly enables the button. */
export function DangerZone({ leagueName, busy, onDelete }: { leagueName: string; busy: boolean; onDelete: (typed: string) => void }) {
  const [typed, setTyped] = useState('');
  return (
    <Card title="Danger zone" className="space-y-3 border-red-alliance/50">
      <p className="text-[15px] text-fg-muted">Deleting the league removes every round, pick and adjustment. It can&apos;t be undone.</p>
      <Input label={`Type ${leagueName} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      <Button type="button" variant="danger" disabled={busy || typed.trim() !== leagueName} onClick={() => onDelete(typed)}>
        Delete league
      </Button>
    </Card>
  );
}
