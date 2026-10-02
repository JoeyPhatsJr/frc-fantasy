import { Alert } from '@/components/ui/Alert';
import { InfoTip } from '@/components/ui/InfoTip';
import { formatClock, URGENT_MS } from '@/lib/draft/client';
import { picksUntilTurn } from '@/lib/draft/live';
import type { DraftState } from '@/lib/draft/state';
import { ordinal } from '@/lib/format';
import { GLOSSARY } from '@/lib/glossary';

export type BannerLines = { main: string; clock: string | null; sub: string | null; urgent: boolean };

/**
 * Spec §7.6 / UX §6.6 banner copy, as data so it's testable without a browser. `myPosition` is my 1-based
 * place in the draft order (null for watchers or before the order is set); `playerCount` is the order's length.
 */
export function bannerLines(
  state: DraftState,
  remainingMs: number | null,
  meId: string | null,
  myPosition: number | null = null,
  playerCount = 0,
): BannerLines {
  const size = { rosterSize: state.rosterSize, draftOrder: state.order.map((o) => o.playerId) };
  const until = meId && state.phase !== 'done' ? picksUntilTurn(size, state.pickNumber, meId) : null;
  const sub = until === null ? null : until === 0 ? 'Your pick!' : `You're up in ${until} pick${until === 1 ? '' : 's'}`;
  switch (state.phase) {
    case 'setup':
      return {
        main: "Draft hasn't started",
        clock: null,
        sub: myPosition === null ? null : `You pick ${ordinal(myPosition)} of ${playerCount}`,
        urgent: false,
      };
    case 'paused':
      return {
        main: 'Paused by the commissioner',
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

/**
 * The draft room's sticky status strip on the dark band, just under the app header (h-14).
 * The band is dark in both themes, so text uses on-band / band-muted, and gold (accent) reads as text here.
 */
export function DraftRoomBanner({
  state,
  remainingMs,
  meId,
  reconnecting,
  myPosition,
  playerCount,
}: {
  state: DraftState;
  remainingMs: number | null;
  meId: string | null;
  reconnecting: boolean;
  myPosition: number | null;
  playerCount: number;
}) {
  const b = bannerLines(state, remainingMs, meId, myPosition, playerCount);
  const mine = b.sub === 'Your pick!';
  return (
    <div className="sticky top-14 z-20 -mx-4 bg-band px-4 py-3 text-on-band space-y-1">
      {reconnecting ? <Alert tone="warning">Reconnecting…</Alert> : null}
      {/* The ticking clock stays out of the live region so screen readers aren't read every second. */}
      <p className="sr-only" aria-live="polite">
        {b.main}
        {b.sub ? `. ${b.sub}` : ''}
      </p>
      <p aria-hidden="true" className="font-display text-[22px] font-bold leading-[26px]">
        {b.main}
        {b.clock ? (
          <>
            {' · '}
            {/* Red fill with white numerals: red text is too dark to read on the band in the light theme. */}
            <span className={`tabular-nums ${b.urgent ? 'rounded-[4px] bg-red-alliance px-1 text-on-primary' : ''}`}>
              {b.clock}
            </span>
          </>
        ) : null}
      </p>
      {b.sub ? (
        mine ? (
          <p aria-hidden="true" className="font-display text-[24px] font-bold leading-7 text-accent">
            {b.sub}
          </p>
        ) : (
          <p aria-hidden="true" className="text-[15px] font-semibold text-on-band">
            {b.sub}
          </p>
        )
      ) : null}
      {state.phase === 'setup' ? (
        // InfoTip draws itself in fg / fg-muted; on the band those become on-band / band-muted.
        <p className="flex items-start text-[13px] font-semibold leading-5 text-band-muted [--color-fg-muted:var(--color-band-muted)] [--color-fg:var(--color-on-band)]">
          {GLOSSARY.snake.label}
          <InfoTip term="snake" />
        </p>
      ) : null}
    </div>
  );
}
