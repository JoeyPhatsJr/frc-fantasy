'use client';

import { useId, useState, type ReactNode } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ArrowRight, Plus, Trash2 } from '@/components/ui/icons';
import { FIELD_BASE } from '@/components/ui/Input';
import { defaultScoring, scoringConfigSchema, type ScoringConfig } from '@/lib/scoring/config';

const NUMBER_BOX = `${FIELD_BASE} shrink-0 px-2 text-right tabular-nums`;

/** An empty box becomes NaN, which fails validation with a clear message instead of silently saving 0. */
const toNumber = (raw: string) => (raw === '' ? Number.NaN : Number(raw));
const shown = (value: number) => (Number.isNaN(value) ? '' : value);

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <label htmlFor={id} className="min-w-0 flex-1 text-sm font-semibold text-fg">
        {label}
      </label>
      <input
        id={id}
        type="number"
        step={1}
        inputMode="numeric"
        value={shown(value)}
        onChange={(e) => onChange(toNumber(e.target.value))}
        className={`${NUMBER_BOX} w-20`}
      />
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-2 rounded-xl border border-border bg-surface-2 p-3">
      <legend className="rounded-pill bg-surface px-2 font-display text-base font-bold uppercase tracking-wide text-fg">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

export function ScoringForm({
  initial,
  saveLabel,
  onSave,
}: {
  initial: ScoringConfig;
  saveLabel: string;
  onSave: (config: ScoringConfig) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ScoringConfig>(() => structuredClone(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (patch: Partial<ScoringConfig>) => {
    setSaved(false);
    setDraft((d) => ({ ...d, ...patch }));
  };

  async function save() {
    setError(null);
    const parsed = scoringConfigSchema.safeParse(draft);
    if (!parsed.success) {
      setError('Every box needs a whole number from -1000 to 1000, and rank tiers must go in ascending order.');
      return;
    }
    setBusy(true);
    try {
      await onSave(parsed.data);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Group title="Qualification matches">
        <NumberField label="Per win" value={draft.qualWin} onChange={(v) => set({ qualWin: v })} />
        <NumberField label="Per tie" value={draft.qualTie} onChange={(v) => set({ qualTie: v })} />
        <NumberField label="Per loss" value={draft.qualLoss} onChange={(v) => set({ qualLoss: v })} />
        <NumberField label="Per ranking point" value={draft.rankingPoint} onChange={(v) => set({ rankingPoint: v })} />
      </Group>

      <Group title="Qualification rank">
        <ul className="space-y-2">
          {draft.rankTiers.map((tier, i) => (
            // Two no-wrap chunks, so at 360px a tier reads "Rank [1] or better → [10]" with Remove below.
            <li key={i} className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                Rank
                <input
                  type="number"
                  step={1}
                  min={1}
                  inputMode="numeric"
                  aria-label={`Tier ${i + 1}: up to rank`}
                  value={shown(tier.maxRank)}
                  onChange={(e) =>
                    set({
                      rankTiers: draft.rankTiers.map((t, j) => (j === i ? { ...t, maxRank: toNumber(e.target.value) } : t)),
                    })
                  }
                  className={`${NUMBER_BOX} w-14`}
                />
                or better
              </span>
              <span className="flex items-center gap-2">
                <ArrowRight className="size-4 shrink-0 text-fg-muted" />
                <input
                  type="number"
                  step={1}
                  inputMode="numeric"
                  aria-label={`Tier ${i + 1}: points`}
                  value={shown(tier.points)}
                  onChange={(e) =>
                    set({
                      rankTiers: draft.rankTiers.map((t, j) => (j === i ? { ...t, points: toNumber(e.target.value) } : t)),
                    })
                  }
                  className={`${NUMBER_BOX} w-14`}
                />
              </span>
              <Button
                type="button"
                variant="danger"
                className="ml-auto"
                aria-label={`Remove tier ${i + 1}`}
                onClick={() => set({ rankTiers: draft.rankTiers.filter((_, j) => j !== i) })}
              >
                <Trash2 className="size-4 shrink-0" />
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="secondary"
          disabled={draft.rankTiers.length >= 20}
          onClick={() => {
            const last = draft.rankTiers.at(-1);
            set({ rankTiers: [...draft.rankTiers, { maxRank: (last?.maxRank ?? 0) + 8, points: 1 }] });
          }}
        >
          <Plus className="size-4 shrink-0" />
          Add tier
        </Button>
        <p className="text-xs text-fg-muted">A team gets the first tier it fits. Ranks below the last tier get 0.</p>
      </Group>

      <Group title="Alliance selection">
        <NumberField label="Captain" value={draft.alliance.captain} onChange={(v) => set({ alliance: { ...draft.alliance, captain: v } })} />
        <NumberField label="First pick" value={draft.alliance.pick1} onChange={(v) => set({ alliance: { ...draft.alliance, pick1: v } })} />
        <NumberField label="Second pick" value={draft.alliance.pick2} onChange={(v) => set({ alliance: { ...draft.alliance, pick2: v } })} />
        <NumberField label="Third pick" value={draft.alliance.pick3} onChange={(v) => set({ alliance: { ...draft.alliance, pick3: v } })} />
        <NumberField label="Backup robot" value={draft.alliance.backup} onChange={(v) => set({ alliance: { ...draft.alliance, backup: v } })} />
      </Group>

      <Group title="Playoffs">
        <NumberField label="Per playoff match win" value={draft.playoffMatchWin} onChange={(v) => set({ playoffMatchWin: v })} />
        <NumberField label="Event winner" value={draft.eventWinner} onChange={(v) => set({ eventWinner: v })} />
        <NumberField label="Event finalist" value={draft.eventFinalist} onChange={(v) => set({ eventFinalist: v })} />
      </Group>

      <Group title="Awards">
        {(
          [
            ['0', 'Impact Award'],
            ['9', 'Engineering Inspiration'],
            ['10', 'Rookie All-Star'],
          ] as const
        ).map(([type, label]) => (
          <NumberField
            key={type}
            label={label}
            value={draft.awards.byType[type] ?? draft.awards.default}
            onChange={(v) => set({ awards: { ...draft.awards, byType: { ...draft.awards.byType, [type]: v } } })}
          />
        ))}
        <NumberField
          label="Any other team award"
          value={draft.awards.default}
          onChange={(v) => set({ awards: { ...draft.awards, default: v } })}
        />
        <p className="text-xs text-fg-muted">
          Winner, finalist, seed, and individual awards never score here. Offseason events usually have no
          awards on The Blue Alliance, so add those as adjustments.
        </p>
      </Group>

      <Group title="OPR bonus (after quals)">
        {draft.oprBonus.map((points, i) => (
          <NumberField
            key={i}
            label={`OPR rank #${i + 1}`}
            value={points}
            onChange={(v) => set({ oprBonus: draft.oprBonus.map((p, j) => (j === i ? v : p)) })}
          />
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={draft.oprBonus.length >= 10}
            onClick={() => set({ oprBonus: [...draft.oprBonus, 1] })}
          >
            <Plus className="size-4 shrink-0" />
            Add a place
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={draft.oprBonus.length === 0}
            onClick={() => set({ oprBonus: draft.oprBonus.slice(0, -1) })}
          >
            Remove last place
          </Button>
        </div>
      </Group>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {saved ? <Alert tone="success">Saved.</Alert> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" busy={busy} onClick={save}>
          {busy ? 'Saving…' : saveLabel}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setSaved(false);
            setError(null);
            setDraft(defaultScoring());
          }}
        >
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
