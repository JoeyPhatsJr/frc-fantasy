'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Ellipsis } from '@/components/ui/icons';
import { Row } from '@/components/ui/Row';
import { Section } from '@/components/ui/Section';
import { Sheet } from '@/components/ui/Sheet';
import type { AdminPlayer } from '@/lib/api/types';

export function removeConfirmText(p: AdminPlayer): string {
  return p.inUse
    ? `Remove ${p.name}? They have picks or are in a draft order, so they stay in past standings as “${p.name} (left)”.`
    : `Remove ${p.name} from the league?`;
}

/**
 * What the ⋯ menu offers for a member: the role to switch them to (linked members only), and whether
 * they can be removed. A "(left)" row with history stays for the standings; one without history can
 * go, so it stops counting toward the cap.
 */
export function memberActions(p: AdminPlayer): { role: 'commissioner' | 'player' | null; remove: boolean } {
  return {
    role: p.linked ? (p.role === 'commissioner' ? 'player' : 'commissioner') : null,
    remove: p.linked || !p.inUse,
  };
}

type Props = {
  players: AdminPlayer[];
  me: string;
  busy: boolean;
  /** The running action's key, e.g. "role:{id}", "remove:{id}". */
  pending: string | null;
  onRole: (id: string, role: 'commissioner' | 'player') => void;
  onRemove: (p: AdminPlayer) => void;
};

/** Members section of the league admin page (spec §7.1): a row per member, actions behind ⋯. */
export function MembersCardView({
  players,
  me,
  busy,
  pending,
  onRole,
  onRemove,
  openId,
  onOpen,
  onClose,
}: Props & { openId: string | null; onOpen: (id: string) => void; onClose: () => void }) {
  const open = players.find((p) => p.id === openId) ?? null;
  const actions = open ? memberActions(open) : null;
  return (
    <Section label="Members">
      {players.map((p) => {
        const { role, remove } = memberActions(p);
        const working = pending === `role:${p.id}` || pending === `remove:${p.id}`;
        return (
          <Row
            key={p.id}
            title={`${p.name}${p.id === me ? ' (you)' : ''}${!p.linked ? ' (left)' : ''}`}
            subtitle={p.role === 'commissioner' ? <span className="font-semibold text-secondary">Commissioner</span> : undefined}
            trailing={
              role || remove ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Options for ${p.name}`}
                  aria-haspopup="dialog"
                  busy={working}
                  disabled={busy}
                  onClick={() => onOpen(p.id)}
                >
                  {working ? null : <Ellipsis className="size-5" />}
                </Button>
              ) : undefined
            }
          />
        );
      })}
      <Sheet open={open !== null} onClose={onClose} title={open?.name ?? ''}>
        {open && actions ? (
          <div className="flex flex-col gap-2">
            {actions.role ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  onClose();
                  onRole(open.id, actions.role!);
                }}
              >
                {actions.role === 'commissioner' ? 'Make commissioner' : 'Make player'}
              </Button>
            ) : null}
            {actions.remove ? (
              <Button
                type="button"
                variant="danger"
                aria-label={`Remove ${open.name}`}
                disabled={busy}
                onClick={() => {
                  if (window.confirm(removeConfirmText(open))) {
                    onClose();
                    onRemove(open);
                  }
                }}
              >
                Remove
              </Button>
            ) : null}
          </div>
        ) : null}
      </Sheet>
    </Section>
  );
}

export function MembersCard(props: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  return <MembersCardView {...props} openId={openId} onOpen={setOpenId} onClose={() => setOpenId(null)} />;
}
