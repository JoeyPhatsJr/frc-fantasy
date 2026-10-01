'use client';

import type { SectionProps } from '@/components/admin/RoundAdmin';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { PICK_SECONDS } from '@/lib/db/types';

/** Spec §7.3 commissioner controls: draft mode and timer (before start / while paused), Start, Pause, Resume. */
export function LiveDraftControls({ detail, busy, run, api, slug }: SectionProps & { slug: string }) {
  const { round } = detail;
  const phase = detail.draftPhase;
  const started = round.draftStartedAt !== null;
  const patch = (body: object, done: string) => run(() => api(`/rounds/${round.id}`, { method: 'PATCH', body }), done);
  const control = (action: 'start' | 'pause' | 'resume', done: string) =>
    run(() => api(`/rounds/${round.id}/draft/${action}`, { method: 'POST' }), done);

  return (
    <div className="space-y-4">
      <Select
        label="How picks are made"
        value={round.draftMode}
        disabled={busy || started || detail.picks.length > 0}
        onChange={(ev) => void patch({ draftMode: ev.target.value }, 'Draft mode saved')}
      >
        <option value="commissioner">Commissioner enters picks</option>
        <option value="live">Live draft on everyone&apos;s phones</option>
      </Select>

      {round.draftMode === 'live' ? (
        <>
          <Select
            label="Pick timer"
            value={round.pickSeconds === null ? 'off' : String(round.pickSeconds)}
            disabled={busy || (started && phase !== 'paused')}
            onChange={(ev) =>
              void patch({ pickSeconds: ev.target.value === 'off' ? null : Number(ev.target.value) }, 'Timer saved')
            }
          >
            <option value="off">Off (no time limit)</option>
            {PICK_SECONDS.map((s) => (
              <option key={s} value={s}>
                {s} seconds
              </option>
            ))}
          </Select>
          <div className="flex flex-wrap gap-2">
            {phase === 'setup' ? (
              <Button disabled={busy} onClick={() => void control('start', 'Draft started')}>
                Start draft
              </Button>
            ) : null}
            {phase === 'live' ? (
              <Button variant="secondary" disabled={busy} onClick={() => void control('pause', 'Draft paused')}>
                Pause
              </Button>
            ) : null}
            {phase === 'paused' ? (
              <Button disabled={busy} onClick={() => void control('resume', 'Draft resumed')}>
                Resume
              </Button>
            ) : null}
            <Button variant="secondary" href={`/l/${slug}/r/${round.id}/draft`}>
              Open draft room
            </Button>
          </div>
          <p className="text-sm text-fg-muted">
            Everyone drafts from their own phone. Undo and &ldquo;Pick for&rdquo; work in the draft room and in the
            draft entry below.
          </p>
        </>
      ) : null}
    </div>
  );
}
