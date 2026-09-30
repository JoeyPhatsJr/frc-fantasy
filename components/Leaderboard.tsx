export type LeaderboardRow = {
  id: string;
  rank: number;
  name: string;
  total: number;
  /** Small muted text under the name, such as a per-round breakdown. */
  detail?: string;
};

// Gold, silver and bronze medals for the top three; everyone else gets a plain circle.
const MEDAL: Record<number, string> = {
  1: 'bg-accent text-on-accent',
  2: 'bg-slate-300 text-slate-900',
  3: 'bg-amber-700 text-on-primary',
};

export function Leaderboard({ rows, emptyText }: { rows: LeaderboardRow[]; emptyText: string }) {
  if (rows.length === 0) return <p className="text-sm text-fg-muted">{emptyText}</p>;
  return (
    <ol className="space-y-2">
      {rows.map((row) => {
        const leader = row.rank === 1;
        return (
          <li
            key={row.id}
            className={[
              'flex min-h-14 items-center gap-3 rounded-xl border border-border px-3 py-2',
              leader ? 'border-l-4 border-l-accent bg-accent/5' : 'bg-surface',
            ].join(' ')}
          >
            <span
              className={[
                'flex size-9 shrink-0 items-center justify-center rounded-full font-display text-lg font-bold tabular-nums',
                MEDAL[row.rank] ?? 'bg-surface-2 text-fg-muted',
              ].join(' ')}
            >
              {row.rank}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-fg" title={row.name}>
                {row.name}
              </span>
              {row.detail ? (
                <span className="block truncate text-xs text-fg-muted tabular-nums">{row.detail}</span>
              ) : null}
            </span>
            <span className="shrink-0 font-display text-2xl font-bold leading-none text-primary tabular-nums">
              {row.total}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
