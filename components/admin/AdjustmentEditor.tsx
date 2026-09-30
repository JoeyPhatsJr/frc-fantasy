'use client';

import { useState, type FormEvent } from 'react';
import type { SectionProps } from '@/components/admin/RoundAdmin';
import { usePending } from '@/components/admin/usePending';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Plus, Trash2 } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { signed, teamName } from '@/lib/format';
import { parseTeamInput } from '@/lib/teams';

type Form = {
  id: string | null; // null = adding, otherwise editing this adjustment
  target: 'player' | 'team';
  playerId: string;
  team: string;
  points: string;
  reason: string;
};

export function AdjustmentEditor({ detail, busy, run, api, playerNames }: SectionProps) {
  const { round, adjustments } = detail;
  const empty: Form = { id: null, target: 'player', playerId: detail.players[0]?.id ?? '', team: '', points: '', reason: '' };
  const [form, setForm] = useState<Form>(empty);
  const [problem, setProblem] = useState<string | null>(null);
  const { pending, go } = usePending(run);
  const teamNames = Object.fromEntries(detail.pool.filter((t) => t.nickname).map((t) => [t.teamKey, t.nickname as string]));

  function submit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    const points = Number(form.points);
    if (!Number.isInteger(points) || points < -1000 || points > 1000) {
      setProblem('Points must be a whole number from -1000 to 1000.');
      return;
    }
    const teamKey = form.target === 'team' ? parseTeamInput(form.team) : null;
    if (form.target === 'team' && !teamKey) {
      setProblem('Team numbers look like 341 or 341B.');
      return;
    }
    const body = {
      ...(form.target === 'player' ? { playerId: form.playerId } : { teamKey }),
      points,
      reason: form.reason,
    };
    const request = () =>
      form.id === null
        ? api(`/rounds/${round.id}/adjustments`, { method: 'POST', body })
        : api(`/rounds/${round.id}/adjustments/${form.id}`, { method: 'PATCH', body });
    // Clear the form only when the save worked, so a rejected entry can be fixed in place.
    let saved = false;
    go(
      'save',
      async () => {
        await request();
        saved = true;
      },
      form.id === null ? 'Adjustment added.' : 'Adjustment updated.',
    ).then(() => {
      if (saved) setForm(empty);
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">
        For things The Blue Alliance doesn&apos;t score: offseason awards, a tied playoff match the refs
        decided, side bets. Everyone can see these and the reason.
      </p>

      <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-surface-2 p-3">
        <h3 className="font-display text-[17px] font-bold leading-6 text-fg">
          {form.id === null ? 'Add an adjustment' : 'Edit adjustment'}
        </h3>
        <fieldset className="min-w-0">
          <legend className="sr-only">Who gets the points</legend>
          <div className="flex flex-wrap gap-x-4">
            {(['player', 'team'] as const).map((t) => (
              <label key={t} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-fg">
                <input
                  type="radio"
                  name="target"
                  checked={form.target === t}
                  onChange={() => setForm({ ...form, target: t })}
                  className="size-5 cursor-pointer accent-primary"
                />
                {t === 'player' ? 'A player' : 'A team (goes to its owner)'}
              </label>
            ))}
          </div>
        </fieldset>
        {form.target === 'player' ? (
          <Select label="Player" value={form.playerId} onChange={(e) => setForm({ ...form, playerId: e.target.value })}>
            {detail.players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            label="Team number"
            value={form.team}
            onChange={(e) => setForm({ ...form, team: e.target.value })}
            placeholder="Team number"
            autoCapitalize="characters"
            autoCorrect="off"
          />
        )}
        <div className="flex gap-2">
          <Input
            label="Points"
            type="number"
            step={1}
            inputMode="numeric"
            value={form.points}
            onChange={(e) => setForm({ ...form, points: e.target.value })}
            placeholder="Points"
            required
            className="w-24 shrink-0 tabular-nums"
          />
          <Input
            label="Reason"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            placeholder="Reason (everyone sees this)"
            maxLength={200}
            required
            className="min-w-0 flex-1"
          />
        </div>
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            busy={pending === 'save'}
            disabled={busy || (form.target === 'player' && !form.playerId)}
          >
            {form.id === null && pending !== 'save' ? <Plus className="size-4 shrink-0" /> : null}
            {form.id === null ? 'Add adjustment' : 'Save changes'}
          </Button>
          {form.id !== null ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setProblem(null);
                setForm(empty);
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </form>

      {adjustments.length === 0 ? <p className="text-sm text-fg-muted">No adjustments yet.</p> : null}
      {adjustments.length > 0 ? (
        <ul className="space-y-2">
          {adjustments.map((a) => {
            const target = a.playerId ? (playerNames[a.playerId] ?? 'Unknown player') : `Team ${teamName(a.teamKey ?? '', teamNames)}`;
            const editing = form.id === a.id;
            return (
              <li
                key={a.id}
                className={`space-y-2 rounded-xl border bg-surface p-3 ${editing ? 'border-primary' : 'border-border'}`}
              >
                <div className="flex items-start gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-fg" title={target}>
                      {target}
                    </span>
                    <span className="block break-words text-sm text-fg">{a.reason}</span>
                  </span>
                  {/* Same chips as the public list: gold for a bonus, red for a penalty. */}
                  <span
                    className={[
                      'shrink-0 rounded-pill px-2.5 py-0.5 font-display text-lg font-bold tabular-nums',
                      a.points < 0 ? 'bg-red-alliance text-on-primary' : 'bg-accent text-on-accent',
                    ].join(' ')}
                  >
                    {signed(a.points)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    aria-label={`Edit adjustment: ${target}, ${a.reason}`}
                    onClick={() => {
                      setProblem(null);
                      setForm({
                        id: a.id,
                        target: a.playerId ? 'player' : 'team',
                        playerId: a.playerId ?? detail.players[0]?.id ?? '',
                        team: a.teamKey ? a.teamKey.slice(3) : '',
                        points: String(a.points),
                        reason: a.reason,
                      });
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    busy={pending === `delete:${a.id}`}
                    disabled={busy}
                    aria-label={`Delete adjustment: ${target}, ${a.reason}`}
                    onClick={() =>
                      go(
                        `delete:${a.id}`,
                        () => api(`/rounds/${round.id}/adjustments/${a.id}`, { method: 'DELETE' }),
                        'Adjustment deleted.',
                      )
                    }
                  >
                    {pending === `delete:${a.id}` ? null : <Trash2 className="size-4 shrink-0" />}
                    Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
