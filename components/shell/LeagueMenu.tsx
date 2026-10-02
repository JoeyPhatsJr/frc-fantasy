'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CopyButton } from '@/components/CopyButton';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { Ellipsis } from '@/components/ui/icons';
import { leaveLeague, renameMe } from '@/lib/admin/client';
import { NAME_MAX } from '@/lib/leagues/names';

type Message = { tone: 'success' | 'danger'; text: string };

export function leaveConfirmText(leagueName: string): string {
  return `Leave ${leagueName}? If you have picks, you stay in past standings marked “(left)”. You can only rejoin as a new player.`;
}

export type LeagueMenuViewProps = {
  leagueName: string;
  /** Absolute link to this league's standings, for "Copy league link". */
  leagueUrl: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
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

/** The ⋯ button and its sheet, with no state, so each step can be rendered on its own. */
export function LeagueMenuView(p: LeagueMenuViewProps) {
  return (
    <>
      <button
        type="button"
        aria-label="League menu"
        aria-haspopup="dialog"
        aria-expanded={p.open}
        onClick={p.onOpen}
        className="-mr-2 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-on-band hover:bg-on-band/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Ellipsis className="size-6" />
      </button>
      <Sheet open={p.open} onClose={p.onClose} title={p.leagueName}>
        <div className="space-y-5">
          <form
            className="space-y-3"
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

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-[13px] font-semibold uppercase tracking-[.08em] text-fg-muted">League link</p>
            <p className="truncate text-[15px] text-fg" title={p.leagueUrl}>
              {p.leagueUrl}
            </p>
            <CopyButton text={p.leagueUrl} label="Copy league link" />
          </div>

          <div className="border-t border-border pt-4">
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
          </div>
        </div>
      </Sheet>
    </>
  );
}

/**
 * League header, members only (spec §5.3): the ⋯ menu that took over "You in this league" —
 * rename yourself here, copy the league link, or leave.
 */
export function LeagueMenu({ slug, leagueName, name: initialName }: { slug: string; leagueName: string; name: string }) {
  const router = useRouter();
  const path = `/l/${encodeURIComponent(slug)}`;
  const [leagueUrl, setLeagueUrl] = useState(path);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(initialName);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState<'save' | 'leave' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  // The origin is only known in the browser; the server render shows the path.
  useEffect(() => setLeagueUrl(`${window.location.origin}${path}`), [path]);

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
      router.push('/leagues');
    } catch (err) {
      setMessage({ tone: 'danger', text: errorText(err) });
      setConfirming(false);
      setBusy(null);
    }
  }

  return (
    <LeagueMenuView
      leagueName={leagueName}
      leagueUrl={leagueUrl}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => {
        if (busy) return; // let a save or leave finish before the sheet goes away
        setOpen(false);
        setConfirming(false);
        setMessage(null);
      }}
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
