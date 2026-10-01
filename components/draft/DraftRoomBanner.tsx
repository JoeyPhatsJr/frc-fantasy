import { Alert } from '@/components/ui/Alert';
import { formatClock, URGENT_MS } from '@/lib/draft/client';
import { picksUntilTurn } from '@/lib/draft/live';
import type { DraftState } from '@/lib/draft/state';

export type BannerLines = { main: string; clock: string | null; sub: string | null; urgent: boolean };

/** Spec §7.6 banner copy, as data so it's testable without a browser. */
export function bannerLines(state: DraftState, remainingMs: number | null, meId: string | null): BannerLines {
  const size = { rosterSize: state.rosterSize, draftOrder: state.order.map((o) => o.playerId) };
  const until = meId && state.phase !== 'done' ? picksUntilTurn(size, state.pickNumber, meId) : null;
  const sub = until === null ? null : until === 0 ? 'Your pick!' : `You're up in ${until} pick${until === 1 ? '' : 's'}`;
  switch (state.phase) {
    case 'setup':
      return { main: 'Waiting for the commissioner to start the draft', clock: null, sub: null, urgent: false };
    case 'paused':
      return {
        main: 'Paused by commissioner',
        clock: state.pausedRemainingMs === null ? null : `${formatClock(state.pausedRemainingMs)} left`,
        sub,
        urgent: false,
      };
    case 'done':
      return { main: 'Draft complete', clock: null, sub: null, urgent: false };
    default:
      return {
        main: `On the clock: ${state.onClock?.name ?? 'Unknown'}`,
        clock: remainingMs === null ? null : formatClock(remainingMs),
        sub,
        urgent: remainingMs !== null && remainingMs < URGENT_MS,
      };
  }
}

export function DraftRoomBanner({
  state,
  remainingMs,
  meId,
  reconnecting,
}: {
  state: DraftState;
  remainingMs: number | null;
  meId: string | null;
  reconnecting: boolean;
}) {
  const b = bannerLines(state, remainingMs, meId);
  const mine = b.sub === 'Your pick!';
  return (
    <div className="sticky top-0 z-20 -mx-4 space-y-2 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur">
      {reconnecting ? <Alert tone="warning">Reconnecting…</Alert> : null}
      {/* The ticking clock stays out of the live region so screen readers aren't read every second. */}
      <p className="sr-only" aria-live="polite">
        {b.main}
        {b.sub ? `. ${b.sub}` : ''}
      </p>
      <p aria-hidden="true" className="font-display text-[22px] font-bold leading-[26px] text-fg">
        {b.main}
        {b.clock ? (
          <>
            {' · '}
            <span className={`tabular-nums ${b.urgent ? 'text-red-alliance-text' : ''}`}>{b.clock}</span>
          </>
        ) : null}
      </p>
      {b.sub ? (
        // accent-text, not accent: gold fill is too faint as text on a white surface.
        <p aria-hidden="true" className={`text-[15px] font-semibold ${mine ? 'text-accent-text' : 'text-primary'}`}>
          {b.sub}
        </p>
      ) : null}
    </div>
  );
}
