'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { normalizeInviteCode } from '@/lib/leagues/inviteCode';

/**
 * "Have an invite code?" → /join/{CODE} (spec §4.6). Used on the landing page and the Leagues tab.
 * `label` lets the landing page, which already asks the question, label the field plainly.
 */
export function InviteCodeBox({ label = 'Have an invite code?' }: { label?: string }) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const code = normalizeInviteCode(value);
        if (!code) return setError('Invite codes are 6 letters and numbers');
        router.push(`/join/${code}`);
      }}
    >
      <Input
        label={label}
        name="code"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        maxLength={12}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="off"
        placeholder="ABC234"
        error={error}
        className="flex-1"
      />
      {/* mt-[26px] = the label (20px) + gap (6px), so Go lines up with the field, not the error text below it. */}
      <Button type="submit" variant="secondary" className="mt-[26px]">
        Go
      </Button>
    </form>
  );
}
