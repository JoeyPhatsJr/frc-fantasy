'use client';

import { CopyButton } from '@/components/CopyButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { AdminLeague, AdminPlayer } from '@/lib/api/types';

export function removeConfirmText(p: AdminPlayer): string {
  return p.inUse
    ? `Remove ${p.name}? They have picks or are in a draft order, so they stay in past standings as "${p.name} (left)".`
    : `Remove ${p.name} from the league?`;
}

type Props = {
  inviteLink: string;
  league: AdminLeague;
  players: AdminPlayer[];
  me: string;
  busy: boolean;
  /** The running action's key, e.g. "role:{id}", "remove:{id}", "reset", "visibility". */
  pending: string | null;
  onReset: () => void;
  onVisibility: (v: 'link' | 'members') => void;
  onRole: (id: string, role: 'commissioner' | 'player') => void;
  onRemove: (p: AdminPlayer) => void;
};

/** Members section of the commissioner dashboard (spec §4.6). */
export function MembersCard({ inviteLink, league, players, me, busy, pending, onReset, onVisibility, onRole, onRemove }: Props) {
  return (
    <Card title="Members" className="space-y-4">
      <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-3">
        <p className="text-sm font-semibold text-fg">Invite code</p>
        <p className="font-mono text-2xl font-bold tracking-[0.2em] text-fg">{league.inviteCode}</p>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={inviteLink} label="Copy invite link" />
          <Button
            type="button"
            variant="ghost"
            busy={pending === 'reset'}
            disabled={busy}
            onClick={() => {
              if (window.confirm('Make a new code? The old code and link stop working.')) onReset();
            }}
          >
            Reset code
          </Button>
        </div>
      </div>

      <fieldset className="space-y-1">
        <legend className="mb-1 text-sm font-semibold text-fg">Who can see the league?</legend>
        {(
          [
            ['link', 'Anyone with the link'],
            ['members', 'Members only'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              type="radio"
              name="visibility"
              checked={league.visibility === value}
              disabled={busy}
              onChange={() => onVisibility(value)}
              className="size-4"
            />
            <span className="text-fg">{label}</span>
          </label>
        ))}
      </fieldset>

      <ul className="-mx-2 divide-y divide-border">
        {players.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 px-2 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-fg">
                {p.name}
                {p.id === me ? ' (you)' : ''}
                {!p.linked ? ' (left)' : ''}
              </span>
              {p.role === 'commissioner' ? <span className="text-sm font-semibold text-secondary">Commissioner</span> : null}
            </span>
            {p.linked ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  busy={pending === `role:${p.id}`}
                  disabled={busy}
                  onClick={() => onRole(p.id, p.role === 'commissioner' ? 'player' : 'commissioner')}
                >
                  {p.role === 'commissioner' ? 'Make player' : 'Make commissioner'}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  busy={pending === `remove:${p.id}`}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(removeConfirmText(p))) onRemove(p);
                  }}
                >
                  Remove
                </Button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
