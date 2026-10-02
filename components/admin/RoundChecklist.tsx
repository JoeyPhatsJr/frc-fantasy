'use client';

import { type ReactNode, useState } from 'react';
import { Check, ChevronDown } from '@/components/ui/icons';
import { type AdminStep, STEP_TITLE, stepDone } from '@/lib/admin/steps';
import type { RoundKind } from '@/lib/db/types';

export type ChecklistStep = { step: AdminStep; summary: string; preview: string; content: ReactNode };

/** The one-liners under each step title (spec §7.2): `summary` once a step is done, `preview` before. */
export function stepSummaries(input: {
  playerCount: number;
  rosterSize: number;
  picks: number;
  kind: RoundKind;
  manualResults: number;
  finalized: boolean;
}): Record<AdminStep, { summary: string; preview: string }> {
  const manual = input.kind === 'manual';
  return {
    1: {
      summary: `${input.playerCount} players · ${input.rosterSize} teams each`,
      preview: 'Roster size, draft order and the team pool',
    },
    2: {
      summary: `Draft complete · ${input.picks} picks`,
      preview: "Live draft on everyone's phones, or enter picks yourself",
    },
    3: {
      summary: manual ? `${input.manualResults} results entered` : 'Scores came from The Blue Alliance',
      preview: manual
        ? 'Enter results as the event happens. Fix anything with adjustments.'
        : 'Scores update from The Blue Alliance automatically. Fix anything with adjustments.',
    },
    4: {
      summary: input.finalized ? 'Final' : 'Not final yet',
      preview: 'Finalizes on its own after the event',
    },
  };
}

const panelId = (step: AdminStep) => `round-step-${step}`;

function StepCircle({ step, current }: { step: AdminStep; current: AdminStep }) {
  const base =
    'flex size-8 shrink-0 items-center justify-center rounded-full font-display text-[17px] font-bold tabular-nums';
  if (stepDone(step, current)) {
    return (
      <span className={`${base} bg-success text-on-success`}>
        <Check className="size-5" />
        <span className="sr-only">Done:</span>
      </span>
    );
  }
  if (step === current) return <span className={`${base} border-2 border-accent text-fg`}>{step}</span>;
  return <span className={`${base} border border-border text-fg-muted`}>{step}</span>;
}

/** The four numbered steps of round admin. Every step header toggles its own content; nothing is locked. */
export function RoundChecklistView({
  current,
  open,
  steps,
  onToggle,
}: {
  current: AdminStep;
  open: AdminStep[];
  steps: ChecklistStep[];
  onToggle: (s: AdminStep) => void;
}) {
  return (
    // No overflow-hidden here: it would break the sticky team search inside step 2's DraftEntry.
    <ol className="divide-y divide-border rounded-card border border-border bg-surface">
      {steps.map(({ step, summary, preview, content }) => {
        const isOpen = open.includes(step);
        const isCurrent = step === current;
        const line = stepDone(step, current) ? `${summary} · Edit` : isCurrent ? null : preview;
        return (
          <li
            key={step}
            aria-current={isCurrent ? 'step' : undefined}
            className={`first:rounded-t-card last:rounded-b-card ${isCurrent ? 'bg-surface shadow-[inset_4px_0_0_var(--color-accent)]' : ''}`}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId(step)}
              onClick={() => onToggle(step)}
              className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left motion-safe:transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <StepCircle step={step} current={current} />
              <span className="min-w-0 flex-1">
                <span className="block font-display text-[19px] font-bold leading-6 text-fg">{STEP_TITLE[step]}</span>
                {line ? (
                  <span className="block break-words text-[13px] leading-[18px] text-fg-muted">{line}</span>
                ) : null}
              </span>
              <ChevronDown
                className={`size-5 shrink-0 text-fg-muted motion-safe:transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {isOpen ? (
              <div id={panelId(step)} role="region" aria-label={STEP_TITLE[step]} className="px-4 pt-1 pb-5">
                {content}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Opens on `current` (from `adminStep()`, spec §8.2). When `current` moves on (say setup was just saved),
 * that step opens too, without closing the one the commissioner is working in.
 */
export function RoundChecklist({ current, steps }: { current: AdminStep; steps: ChecklistStep[] }) {
  const [open, setOpen] = useState<AdminStep[]>([current]);
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    if (!open.includes(current)) setOpen([...open, current]);
  }
  return (
    <RoundChecklistView
      current={current}
      open={open}
      steps={steps}
      onToggle={(s) => setOpen((o) => (o.includes(s) ? o.filter((x) => x !== s) : [...o, s]))}
    />
  );
}
