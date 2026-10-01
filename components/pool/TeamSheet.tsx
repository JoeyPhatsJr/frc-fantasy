'use client';

import { useEffect, useRef, useState } from 'react';
import { trappedFocusIndex } from '@/components/draft/ConfirmSheet';
import { NewChip, PoolFootnote } from '@/components/pool/PoolStats';
import { Badge } from '@/components/ui/Badge';
import { BumperPlate } from '@/components/ui/BumperPlate';
import { Button } from '@/components/ui/Button';
import { Trophy, X } from '@/components/ui/icons';
import { signed } from '@/lib/format';
import { BEST_FINISH_LABEL, formatProj, formatRecord } from '@/lib/pool/format';
import type { TeamSheetData, TeamSheetSeason } from '@/lib/stats/pool';
import { teamLabel } from '@/lib/teams';

/** Gold text for gains, red for losses (same rule as RosterList; both ≥ 4.5:1 in both themes). */
const pointsTone = (points: number) => (points < 0 ? 'text-red-alliance-text' : 'text-accent-text');

function SeasonHistory({ s }: { s: TeamSheetSeason }) {
  const eventKeys = new Set(s.events.map((e) => e.eventKey));
  // Awards always come from the season's own events; anything else is listed after them, not dropped.
  const otherAwards = s.awards.filter((a) => !eventKeys.has(a.eventKey));
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-display text-[22px] font-bold leading-[26px] text-fg tabular-nums">{s.season}</h3>
        <p className="text-[13px] leading-[18px] text-fg-muted tabular-nums">
          {s.eventsPlayed} {s.eventsPlayed === 1 ? 'event' : 'events'} · {s.totalPoints} pts · {formatRecord(s.record)}
        </p>
      </div>
      {s.events.length > 0 ? (
        <ul className="divide-y divide-border rounded-card border border-border bg-surface-2">
          {s.events.map((e) => (
            <li key={e.eventKey} className="flex min-h-11 items-start justify-between gap-3 px-3 py-2">
              <div className="min-w-0 space-y-0.5">
                <p className="break-words text-[15px] leading-5 text-fg">{e.name}</p>
                <p className="text-[13px] leading-[18px] text-fg-muted">
                  {e.rank !== null ? `#${e.rank}` : 'No rank'}
                  {e.finish ? ` · ${BEST_FINISH_LABEL[e.finish]}` : ''}
                </p>
                {s.awards
                  .filter((a) => a.eventKey === e.eventKey)
                  .map((a, i) => (
                    <p key={`${a.type}-${i}`} className="flex items-start gap-1.5 text-[13px] leading-[18px] text-fg">
                      <Trophy className="mt-px size-4 shrink-0 text-accent-text" />
                      <span className="min-w-0 break-words">{a.name}</span>
                    </p>
                  ))}
              </div>
              <span className={`shrink-0 font-display text-[17px] font-bold tabular-nums ${pointsTone(e.points)}`}>
                {signed(e.points)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {otherAwards.length > 0 ? (
        <ul className="space-y-1">
          {otherAwards.map((a, i) => (
            <li key={`${a.eventKey}-${a.type}-${i}`} className="flex items-start gap-1.5 text-[13px] leading-[18px] text-fg">
              <Trophy className="mt-px size-4 shrink-0 text-accent-text" />
              <span className="min-w-0 break-words">{a.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The sheet's content (spec §6.3). Pure, so it renders in tests without fetching. */
export function TeamSheetBody({ data, nickname }: { data: TeamSheetData; nickname: string | null }) {
  const label = teamLabel(data.teamKey);
  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <BumperPlate number={label} size="lg" />
        <div className="min-w-0 space-y-1">
          <p className="break-words text-[17px] font-semibold leading-[22px] text-fg">{nickname ?? `Team ${label}`}</p>
          {data.proj === null ? (
            <NewChip />
          ) : (
            <p className="text-[13px] font-semibold leading-[18px] text-fg-muted">
              Proj{' '}
              <span className="font-display text-[22px] font-bold leading-none text-fg tabular-nums">
                {formatProj(data.proj)}
              </span>
            </p>
          )}
        </div>
      </header>

      {data.seasons.length === 0 ? (
        <p className="text-[15px] text-fg-muted">
          No results in {data.season - 1} or {data.season} yet, so this team is New.
        </p>
      ) : null}

      {data.seasons.map((s) => (
        <SeasonHistory key={s.season} s={s} />
      ))}

      <PoolFootnote />
    </div>
  );
}

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: TeamSheetData };

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Bottom sheet opened by tapping a pool row (spec §6.3). Close, Escape, or a tap on the scrim dismisses it. */
export function TeamSheet({
  slug,
  roundId,
  teamKey,
  nickname,
  onClose,
}: {
  slug: string;
  roundId: string;
  teamKey: string;
  nickname: string | null;
  onClose: () => void;
}) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const sheet = useRef<HTMLDivElement>(null);
  // Read during the first render, before autoFocus moves focus into the sheet: the row that opened it.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    fetch(`/api/l/${encodeURIComponent(slug)}/rounds/${encodeURIComponent(roundId)}/pool/${encodeURIComponent(teamKey)}`, {
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as TeamSheetData;
      })
      .then((data) => {
        if (!cancelled) setLoad({ status: 'ready', data });
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [slug, roundId, teamKey]);

  // Focus goes back to the row that opened the sheet when it closes.
  useEffect(
    () => () => {
      if (opener instanceof HTMLElement) opener.focus();
    },
    [opener],
  );

  // Escape closes; Tab and Shift+Tab stay inside the sheet instead of reaching the list behind the scrim.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
      if (ev.key === 'Tab' && sheet.current) {
        const nodes = [...sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const next = trappedFocusIndex(nodes.indexOf(document.activeElement as HTMLElement), nodes.length, ev.shiftKey);
        ev.preventDefault();
        nodes[next]?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const label = teamLabel(teamKey);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={`Team ${label} history`}
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-card border-t border-border bg-surface px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-card"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-semibold leading-[18px] text-fg-muted">Last two seasons</p>
          <Button size="icon" variant="ghost" aria-label="Close" autoFocus onClick={onClose}>
            <X className="size-5" />
          </Button>
        </div>
        {load.status === 'loading' ? (
          <p role="status" className="py-6 text-[15px] text-fg-muted">
            Loading team {label}…
          </p>
        ) : null}
        {load.status === 'error' ? (
          <p role="alert" className="py-6 text-[15px] text-fg-muted">
            Couldn&apos;t load this team&apos;s history. Close and tap the team to try again.
          </p>
        ) : null}
        {load.status === 'ready' ? <TeamSheetBody data={load.data} nickname={nickname} /> : null}
      </div>
    </div>
  );
}
