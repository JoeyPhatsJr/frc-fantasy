'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { leaveLeague, renameMe } from '@/lib/admin/client';
import { NAME_MAX } from '@/lib/leagues/names';

type Message = { tone: 'success' | 'danger'; text: string };

export function leaveConfirmText(leagueName: string): string {
  return `Leave ${leagueName}? If you have picks, you stay in past standings marked "(left)". You can only rejoin as a new player.`;
}

type ViewProps = {
  leagueName: string;
  name: string;
  onName: (name: string) => void;
  onSave: () => void;
  onLeave: () => void;
  onConfirmLeave: () => void;
  onCancelLeave: () => void;
  busy: 'save' | 'leave' | null;
  confirming: boolean;
  message: Message | null;
  saveDisabled: boolean;
};

/** The card's markup, with no state, so each step can be rendered on its own. */
export function LeagueMeCardView(p: ViewProps) {
  return (
    <Card title="You in this league" className="space-y-4">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          p.onSave();
        }}
      >
        <Input
          label="Your name in this league"
          value={p.name}
          onChange={(e) => p.onName(e.target.value)}
          maxLength={NAME_MAX}
          autoComplete="nickname"
          required
          hint="This is the name on the standings and draft board here."
        />
        <Button type="submit" variant="secondary" busy={p.busy === 'save'} disabled={p.busy !== null || p.saveDisabled}>
          Save name
        </Button>
      </form>

      {p.message ? <Alert tone={p.message.tone}>{p.message.text}</Alert> : null}

      {p.confirming ? (
        <div className="space-y-3 rounded-xl border border-red-alliance/40 bg-red-alliance/5 p-3">
          <p className="text-[15px] text-fg">{leaveConfirmText(p.leagueName)}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="danger" busy={p.busy === 'leave'} disabled={p.busy !== null} onClick={p.onConfirmLeave}>
              Yes, leave
            </Button>
            <Button type="button" variant="ghost" disabled={p.busy !== null} onClick={p.onCancelLeave}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="danger" disabled={p.busy !== null} onClick={p.onLeave}>
          Leave league
        </Button>
      )}
    </Card>
  );
}

/** League page, members only (spec §4.3 / §4.5): rename yourself in this league, or leave it. */
export function LeagueMeCard({ slug, leagueName, name: initialName }: { slug: string; leagueName: string; name: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initialName);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState<'save' | 'leave' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');

  async function save() {
    setBusy('save');
    setMessage(null);
    try {
      const { player } = await renameMe(slug, name);
      setSaved(player.name);
      setName(player.name);
      setMessage({ tone: 'success', text: 'Saved.' });
      router.refresh(); // the standings show the new name
    } catch (err) {
      setMessage({ tone: 'danger', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  async function leave() {
    setBusy('leave');
    setMessage(null);
    try {
      await leaveLeague(slug);
      window.location.assign('/leagues');
    } catch (err) {
      setMessage({ tone: 'danger', text: errorText(err) });
      setConfirming(false);
      setBusy(null);
    }
  }

  return (
    <LeagueMeCardView
      leagueName={leagueName}
      name={name}
      onName={setName}
      onSave={save}
      onLeave={() => {
        setMessage(null);
        setConfirming(true);
      }}
      onConfirmLeave={leave}
      onCancelLeave={() => setConfirming(false)}
      busy={busy}
      confirming={confirming}
      message={message}
      saveDisabled={name.trim() === '' || name.trim() === saved}
    />
  );
}
