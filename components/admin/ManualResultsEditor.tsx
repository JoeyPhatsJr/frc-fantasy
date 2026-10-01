'use client';

import { useState } from 'react';
import type { SectionProps } from '@/components/admin/RoundAdmin';
import { Button } from '@/components/ui/Button';
import { BumperPlate } from '@/components/ui/BumperPlate';
import { ChevronDown } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { AWARD_CHOICES } from '@/lib/scoring/awardTypes';
import type { ScoringConfig } from '@/lib/scoring/config';
import type { AllianceRole, ManualResult } from '@/lib/scoring/types';
import type { PoolTeam } from '@/lib/teams';

const ROLE_TEXT: Record<AllianceRole, string> = {
  captain: 'Captain',
  pick1: '1st pick',
  pick2: '2nd pick',
  pick3: '3rd pick',
  backup: 'Backup',
};

/** Drafted teams first (in pick order); the rest only when asked, or when nobody is drafted yet. */
export function orderResultRows(pool: PoolTeam[], picks: { teamKey: string }[], showAll: boolean): PoolTeam[] {
  const byKey = new Map(pool.map((t) => [t.teamKey, t]));
  const drafted = picks.map((p) => byKey.get(p.teamKey)).filter((t): t is PoolTeam => t !== undefined);
  if (drafted.length === 0) return pool;
  if (!showAll) return drafted;
  const taken = new Set(drafted.map((t) => t.teamKey));
  return [...drafted, ...pool.filter((t) => !taken.has(t.teamKey))];
}

export function resultSummary(r: ManualResult | undefined): string {
  if (!r) return 'No result yet';
  const parts = [`${r.qualWins}-${r.qualLosses}-${r.qualTies}`];
  if (r.qualRank !== null) parts.push(`#${r.qualRank}`);
  if (r.allianceRole) parts.push(ROLE_TEXT[r.allianceRole]);
  if (r.eventResult) parts.push(r.eventResult === 'winner' ? 'Winner' : 'Finalist');
  if (r.awardTypes.length > 0) parts.push(`${r.awardTypes.length} award${r.awardTypes.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** The form's own copy of a result: text boxes hold strings until Save. */
export type ResultDraft = {
  qualWins: string;
  qualLosses: string;
  qualTies: string;
  rankingPoints: string;
  qualRank: string;
  allianceRole: '' | AllianceRole;
  playoffWins: string;
  eventResult: '' | 'winner' | 'finalist';
  awardTypes: number[];
};

const text = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

export function toDraft(r?: ManualResult): ResultDraft {
  return {
    qualWins: r ? String(r.qualWins) : '',
    qualLosses: r ? String(r.qualLosses) : '',
    qualTies: r ? String(r.qualTies) : '',
    rankingPoints: text(r?.rankingPoints),
    qualRank: text(r?.qualRank),
    allianceRole: r?.allianceRole ?? '',
    playoffWins: r ? String(r.playoffWins) : '',
    eventResult: r?.eventResult ?? '',
    awardTypes: r?.awardTypes ?? [],
  };
}

/** Anything that isn't a whole number becomes -1, which the server rejects with the field's rule. */
function whole(s: string): number {
  const n = Number(s.trim());
  return Number.isInteger(n) ? n : -1;
}
const count = (s: string) => (s.trim() === '' ? 0 : whole(s));
const maybe = (s: string) => (s.trim() === '' ? null : whole(s));

export function fromDraft(d: ResultDraft): Omit<ManualResult, 'teamKey'> {
  return {
    qualWins: count(d.qualWins),
    qualLosses: count(d.qualLosses),
    qualTies: count(d.qualTies),
    rankingPoints: maybe(d.rankingPoints),
    qualRank: maybe(d.qualRank),
    allianceRole: d.allianceRole === '' ? null : d.allianceRole,
    playoffWins: count(d.playoffWins),
    eventResult: d.eventResult === '' ? null : d.eventResult,
    awardTypes: d.awardTypes,
  };
}

function ResultForm({
  initial,
  scoring,
  busy,
  onSave,
  onClear,
}: {
  initial: ManualResult | undefined;
  scoring: ScoringConfig;
  busy: boolean;
  onSave: (body: Omit<ManualResult, 'teamKey'>) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [d, setD] = useState<ResultDraft>(() => toDraft(initial));
  const set = <K extends keyof ResultDraft>(key: K, value: ResultDraft[K]) => setD((prev) => ({ ...prev, [key]: value }));
  const num = (key: 'qualWins' | 'qualLosses' | 'qualTies' | 'rankingPoints' | 'qualRank' | 'playoffWins', label: string) => (
    <Input label={label} type="number" inputMode="numeric" min={0} value={d[key]} onChange={(e) => set(key, e.target.value)} />
  );
  const excluded = new Set(scoring.awards.excludedTypes);
  return (
    <form
      className="space-y-4 pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        await onSave(fromDraft(d));
      }}
    >
      <div className="grid grid-cols-3 gap-2">
        {num('qualWins', 'Wins')}
        {num('qualLosses', 'Losses')}
        {num('qualTies', 'Ties')}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {num('qualRank', 'Final rank')}
        {num('rankingPoints', 'Ranking points')}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select label="Alliance" value={d.allianceRole} onChange={(e) => set('allianceRole', e.target.value as ResultDraft['allianceRole'])}>
          <option value="">Not picked</option>
          {(Object.keys(ROLE_TEXT) as AllianceRole[]).map((role) => (
            <option key={role} value={role}>
              {ROLE_TEXT[role]}
            </option>
          ))}
        </Select>
        {num('playoffWins', 'Playoff wins')}
      </div>
      <Select label="Event result" value={d.eventResult} onChange={(e) => set('eventResult', e.target.value as ResultDraft['eventResult'])}>
        <option value="">Neither</option>
        <option value="winner">Winner</option>
        <option value="finalist">Finalist</option>
      </Select>
      <fieldset className="space-y-1">
        <legend className="text-sm font-semibold text-fg">Awards</legend>
        {AWARD_CHOICES.map((a) => (
          <label key={a.type} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-fg">
            <input
              type="checkbox"
              className="size-5 shrink-0 cursor-pointer accent-primary"
              checked={d.awardTypes.includes(a.type)}
              onChange={(e) =>
                set('awardTypes', e.target.checked ? [...d.awardTypes, a.type] : d.awardTypes.filter((t) => t !== a.type))
              }
            />
            <span className="min-w-0">
              {a.name}
              {excluded.has(a.type) ? <span className="text-fg-muted"> (not scored in this round)</span> : null}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          Save result
        </Button>
        {initial ? (
          <Button type="button" variant="danger" disabled={busy} onClick={() => onClear()}>
            Clear result
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** The Results card of a manual round (spec §5.3): one row per pool team, drafted teams first. */
export function ManualResultsEditor({ detail, busy, run, api }: SectionProps) {
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const results = new Map((detail.manualResults ?? []).map((r) => [r.teamKey, r]));
  const rows = orderResultRows(detail.pool, detail.picks, showAll);
  const hidden = detail.pool.length - rows.length;
  const path = (teamKey: string) => `/rounds/${detail.round.id}/results/${encodeURIComponent(teamKey)}`;

  if (detail.pool.length === 0) {
    return <p className="text-[15px] text-fg-muted">Add teams to the pool (Setup) before entering results.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-[15px] text-fg-muted">Type in each team&apos;s final results. Scores update as soon as you save.</p>
      <ul className="divide-y divide-border">
        {rows.map((team) => (
          <li key={team.teamKey} className="py-1">
            {/* The summary sits under the nickname and may wrap, so a long line never pushes the row sideways at 360 px. */}
            <button
              type="button"
              aria-expanded={open === team.teamKey}
              onClick={() => setOpen(open === team.teamKey ? null : team.teamKey)}
              className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-1 py-1 text-left motion-safe:transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BumperPlate number={team.label} size="sm" />
              <span className="min-w-0 flex-1">
                {team.nickname ? <span className="block truncate text-[15px] text-fg">{team.nickname}</span> : null}
                <span className="block text-[13px] leading-[18px] text-fg-muted tabular-nums">
                  {resultSummary(results.get(team.teamKey))}
                </span>
              </span>
              <ChevronDown
                className={`size-5 shrink-0 text-fg-muted motion-safe:transition-transform duration-200 ${open === team.teamKey ? 'rotate-180' : ''}`}
              />
            </button>
            {open === team.teamKey ? (
              <ResultForm
                key={JSON.stringify(results.get(team.teamKey) ?? null)}
                initial={results.get(team.teamKey)}
                scoring={detail.round.scoring}
                busy={busy}
                onSave={(body) => run(() => api(path(team.teamKey), { method: 'PUT', body }), `Saved ${team.label}.`)}
                onClear={() => run(() => api(path(team.teamKey), { method: 'DELETE' }), `Cleared ${team.label}.`)}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {hidden > 0 || showAll ? (
        <Button type="button" variant="secondary" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show drafted teams only' : 'Show all teams'}
        </Button>
      ) : null}
    </div>
  );
}
