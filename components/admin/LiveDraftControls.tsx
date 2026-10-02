'use client';

import type { SectionProps } from '@/components/admin/RoundAdmin';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { PICK_SECONDS } from '@/lib/db/types';

/**
 * "Switch to {other method}" under step 2 of round admin (UX spec §7.2). Same PATCH `{ draftMode }` and the
 * same guard the old "How picks are made" select had: no switching once the draft started or has picks.
 */
export function DraftModeSwitch({ detail, busy, run, api }: SectionProps) {
  const { round } = detail;
  const locked = round.draftStartedAt !== null || detail.picks.length > 0;
  const other = round.draftMode === 'live' ? 'commissioner' : 'live';
  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy || locked}
        onClick={() =>
          void run(() => api(`/rounds/${round.id}`, { method: 'PATCH', body: { draftMode: other } }), 'Draft mode saved')
        }
      >
        Switch to {other === 'live' ? 'a live draft' : 'entering picks by hand'}
      </Button>
      {locked ? (
        <p className="text-[13px] leading-[18px] text-fg-muted">You can&apos;t switch once the draft has started.</p>
      ) : null}
    </div>
  );
}

/** Spec §7.3 commissioner controls for a live draft: timer (before start / while paused), Start, Pause, Resume. */
export function LiveDraftControls({ detail, busy, run, api, slug }: SectionProps & { slug: string }) {
  const { round } = detail;
  const phase = detail.draftPhase;
  const started = round.draftStartedAt !== null;
  const patch = (body: object, done: string) => run(() => api(`/rounds/${round.id}`, { method: 'PATCH', body }), done);
  const control = (action: 'start' | 'pause' | 'resume', done: string) =>
    run(() => api(`/rounds/${round.id}/draft/${action}`, { method: 'POST' }), done);

  // Round admin shows this only for live drafts; the guard stays so it can never offer Start for the other mode.
  if (round.draftMode !== 'live') return null;

  return (
    <div className="space-y-4">
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
        Everyone drafts from their own phone. Undo and &ldquo;Pick for&rdquo; work in the draft room.
      </p>
    </div>
  );
}
