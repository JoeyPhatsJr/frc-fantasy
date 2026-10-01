export type LeaderboardRow = {
  id: string;
  rank: number;
  name: string;
  total: number;
  /** Small muted text under the name, such as a per-round breakdown. */
  detail?: string;
};

// Gold, silver and bronze circles for the top three; everyone else gets a quiet one.
const RANK_CIRCLE: Record<number, string> = {
  1: 'bg-accent text-on-accent',
  2: 'bg-silver text-on-accent',
  3: 'bg-bronze text-on-accent',
};

/**
 * The scoreboard: rank circle, name, big tabular score. The leader's row carries the gold (a rail
 * and a faint tint). Rows fade up with a 40ms stagger when they first appear (motion-safe only);
 * a refresh reuses the same DOM nodes, so the animation doesn't replay.
 */
export function Leaderboard({
  rows,
  emptyText,
  animate = true,
}: {
  rows: LeaderboardRow[];
  emptyText: string;
  /** False for static displays (the landing page's sample) that shouldn't move on load. */
  animate?: boolean;
}) {
  if (rows.length === 0) return <p className="text-sm text-fg-muted">{emptyText}</p>;
  return (
    <ol className="divide-y divide-border">
      {rows.map((row, index) => {
        const leader = row.rank === 1;
        return (
          <li
            key={row.id}
            style={animate ? { animationDelay: `${index * 40}ms` } : undefined}
            className={[
              'flex min-h-14 items-center gap-3 py-2 pr-3',
              animate && 'motion-safe:animate-fade-up',
              // Gold tint: /15 reads as gold in dark; light keeps /10, where accent-text on /15 would drop to 4.47:1.
              leader
                ? 'rounded-lg border-l-[3px] border-l-accent bg-accent/15 pl-[9px] [[data-theme=light]_&]:bg-accent/10'
                : 'pl-3',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span
              className={[
                'flex size-8 shrink-0 items-center justify-center rounded-full font-display text-[17px] font-bold leading-none tabular-nums',
                RANK_CIRCLE[row.rank] ?? 'bg-surface-2 text-fg-muted',
              ].join(' ')}
            >
              {row.rank}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[17px] font-semibold leading-6 text-fg" title={row.name}>
                {row.name}
              </span>
              {row.detail ? (
                <span className="block truncate text-[13px] leading-[18px] text-fg-muted tabular-nums [word-spacing:0.35em]">
                  {row.detail}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-right font-display text-[28px] font-bold leading-[30px] text-fg tabular-nums">
              {row.total}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
