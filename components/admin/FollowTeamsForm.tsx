'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { parseFollowInput } from '@/lib/follow/input';

/** League setting "Follow teams" (spec §5.4): their events become rounds automatically. */
export function FollowTeamsForm({
  follows,
  busy,
  saving,
  onSave,
}: {
  follows: number[];
  busy: boolean;
  saving: boolean;
  onSave: (teams: number[]) => Promise<boolean>;
}) {
  const [value, setValue] = useState(follows.join(', '));
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = parseFollowInput(value);
        if ('error' in parsed) {
          setError(parsed.error);
          return;
        }
        setError(null);
        await onSave(parsed.teams);
      }}
    >
      {/* No inputMode="numeric": the iPhone number pad has no comma or space, so a second team couldn't be typed. */}
      <Input
        label="Follow teams (up to 3)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. 5181, 341"
        autoComplete="off"
        error={error}
        hint="Follow up to 3 teams and we'll add each event they attend automatically. Delete one and it stays deleted."
      />
      <Button type="submit" variant="secondary" busy={saving} disabled={busy}>
        Save followed teams
      </Button>
    </form>
  );
}
