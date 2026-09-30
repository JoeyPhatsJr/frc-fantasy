'use client';

import { useState } from 'react';
import type { SectionProps } from '@/components/admin/RoundAdmin';
import { ScoringForm } from '@/components/admin/ScoringForm';
import { usePending } from '@/components/admin/usePending';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ArrowDown, ArrowUp, ChevronDown, Plus, X } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { moveItem, shuffled } from '@/lib/draft';
import { parseTeamInput } from '@/lib/teams';

/** The summary of a <details> styled as a secondary button, matching the dashboard's. */
export const DETAILS_SUMMARY =
  'flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl border border-primary/40 ' +
  'bg-surface px-4 font-semibold text-primary motion-safe:transition-colors duration-200 hover:bg-surface-2 ' +
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
  '[&::-webkit-details-marker]:hidden';

const SUBHEAD = 'font-display text-[17px] font-bold leading-6 text-fg';

export function RoundSetup({ detail, busy, run, api, playerNames }: SectionProps) {
  const { round } = detail;
  const locked = detail.picks.length > 0;
  const [order, setOrder] = useState<string[]>(round.draftOrder);
  const [rosterSize, setRosterSize] = useState(round.rosterSize);
  const [teamInput, setTeamInput] = useState('');
  const { pending, go } = usePending(run);

  const notDrafting = detail.players.filter((p) => !order.includes(p.id));
  const maxAllowed = order.length === 0 ? 10 : Math.min(10, Math.floor(detail.pool.length / order.length));
  const tooBig = order.length > 0 && rosterSize > maxAllowed;
  const changed = rosterSize !== round.rosterSize || order.join(',') !== round.draftOrder.join(',');
  const manualTeams = detail.pool.filter((t) => t.manual);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h3 className={SUBHEAD}>Draft order and roster size</h3>
        {locked ? <Alert tone="info">Undo all picks to change the draft order or roster size.</Alert> : null}

        <ol className="space-y-2">
          {order.map((id, i) => (
            <li
              key={id}
              className="flex items-center gap-2 rounded-xl border border-border bg-surface py-1 pr-1 pl-3"
            >
              <span className="w-5 shrink-0 font-display text-lg font-bold text-fg-muted tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-semibold text-fg">{playerNames[id] ?? 'Unknown'}</span>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                disabled={locked || i === 0}
                aria-label="Move up"
                onClick={() => setOrder(moveItem(order, i, -1))}
              >
                <ArrowUp className="size-5" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                disabled={locked || i === order.length - 1}
                aria-label="Move down"
                onClick={() => setOrder(moveItem(order, i, 1))}
              >
                <ArrowDown className="size-5" />
              </Button>
              <Button
                type="button"
                variant="danger"
                size="icon"
                disabled={locked}
                aria-label={`Take ${playerNames[id] ?? 'this player'} out of the draft`}
                onClick={() => setOrder(order.filter((x) => x !== id))}
              >
                <X className="size-5" />
              </Button>
            </li>
          ))}
        </ol>
        {order.length === 0 ? <p className="text-sm text-fg-muted">Nobody is drafting yet.</p> : null}

        {notDrafting.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {notDrafting.map((p) => (
              <Button
                key={p.id}
                type="button"
                variant="secondary"
                className="max-w-full"
                disabled={locked}
                aria-label={`Add ${p.name} to the draft`}
                onClick={() => setOrder([...order, p.id])}
              >
                <Plus className="size-4 shrink-0" />
                <span className="min-w-0 truncate">{p.name}</span>
              </Button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Roster size"
            value={rosterSize}
            disabled={locked}
            onChange={(e) => setRosterSize(Number(e.target.value))}
            className="w-28"
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="secondary"
            disabled={locked || order.length < 2}
            onClick={() => setOrder(shuffled(order))}
          >
            Randomize order
          </Button>
        </div>
        <p className={`text-sm tabular-nums ${tooBig ? 'font-semibold text-red-alliance-text' : 'text-fg-muted'}`}>
          {order.length} {order.length === 1 ? 'player' : 'players'} × {rosterSize} teams = {order.length * rosterSize}{' '}
          picks from a pool of {detail.pool.length}.{' '}
          {order.length > 0 ? `Roster size can be at most ${maxAllowed}.` : ''}
        </p>
        <Button
          type="button"
          busy={pending === 'setup'}
          disabled={busy || locked || !changed || rosterSize > maxAllowed}
          onClick={() =>
            go(
              'setup',
              () => api(`/rounds/${round.id}`, { method: 'PATCH', body: { draftOrder: order, rosterSize } }),
              'Draft setup saved.',
            )
          }
        >
          Save draft setup
        </Button>
      </div>

      <div className="space-y-3">
        <h3 className={SUBHEAD}>Team pool</h3>
        {detail.poolStale ? (
          <Alert tone="warning">Couldn&apos;t reach The Blue Alliance; the team list may be out of date.</Alert>
        ) : null}
        <p className="text-sm text-fg-muted">
          {detail.pool.length - manualTeams.length} teams from The Blue Alliance, {manualTeams.length} added by hand.
          Offseason team lists are often incomplete until event day; add missing teams here.
        </p>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const key = parseTeamInput(teamInput);
            if (!key) return;
            // Clear the box only when the add worked, so a rejected number can be fixed in place.
            let added = false;
            go(
              'add-team',
              async () => {
                await api(`/rounds/${round.id}/teams`, { method: 'POST', body: { teamNumber: teamInput } });
                added = true;
              },
              `Added ${key.slice(3)}.`,
            ).then(() => {
              if (added) setTeamInput('');
            });
          }}
        >
          <Input
            label="Team number to add"
            value={teamInput}
            onChange={(e) => setTeamInput(e.target.value)}
            placeholder="Team number, e.g. 341 or 341B"
            autoCapitalize="characters"
            autoCorrect="off"
            className="min-w-0 flex-1"
          />
          <Button
            type="submit"
            className="shrink-0"
            busy={pending === 'add-team'}
            disabled={busy || parseTeamInput(teamInput) === null}
          >
            {pending === 'add-team' ? null : <Plus className="size-4 shrink-0" />}
            Add team
          </Button>
        </form>
        {manualTeams.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {manualTeams.map((t) => (
              <li
                key={t.teamKey}
                className="flex items-center gap-1 rounded-pill border border-border bg-surface-2 py-0.5 pr-0.5 pl-3"
              >
                <span className="font-display text-lg font-bold text-fg tabular-nums">{t.label}</span>
                <Button
                  type="button"
                  variant="danger"
                  size="icon"
                  busy={pending === `remove:${t.teamKey}`}
                  disabled={busy}
                  aria-label={`Take team ${t.label} out of the pool`}
                  onClick={() =>
                    go(`remove:${t.teamKey}`, () => api(`/rounds/${round.id}/teams/${t.teamKey}`, { method: 'DELETE' }))
                  }
                >
                  {pending === `remove:${t.teamKey}` ? null : <X className="size-5" />}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <details className="group">
          <summary className={DETAILS_SUMMARY}>
            Show all {detail.pool.length} teams
            <ChevronDown className="size-5 shrink-0 motion-safe:transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1 pt-3 text-sm">
            {detail.pool.map((t) => (
              <li key={t.teamKey} className="truncate text-fg-muted">
                <span className="font-display text-base font-bold text-fg tabular-nums">{t.label}</span>{' '}
                {t.nickname ?? ''}
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div className="space-y-3">
        <h3 className={SUBHEAD}>Scoring for this round</h3>
        <p className="text-sm text-fg-muted">Only this round changes. Scores update as soon as you save.</p>
        <ScoringForm
          initial={round.scoring}
          saveLabel="Save round scoring"
          onSave={async (scoring) => {
            // Saved directly (not through `run`) so a failed save throws into the form's own error message
            // instead of the form also claiming "Saved."; then `run` reloads and shows the notice.
            await api(`/rounds/${round.id}`, { method: 'PATCH', body: { scoring } });
            await run(async () => {}, 'Round scoring saved.');
          }}
        />
      </div>
    </div>
  );
}
