const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A calendar-tile date: month abbreviation over the day number. Reads the YYYY-MM-DD string
 * directly, so the day never shifts with the viewer's timezone.
 */
export function DateBlock({ date, className }: { date: string; className?: string }) {
  const [, month, day] = date.split('-').map(Number);
  return (
    <time
      dateTime={date}
      className={[
        'flex size-12 shrink-0 flex-col items-center justify-center rounded-lg border border-border bg-surface-2 font-display leading-none',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="text-[13px] font-semibold text-fg-muted">{MONTHS[month - 1] ?? ''}</span>
      <span className="text-[22px] font-bold text-fg tabular-nums">{day}</span>
    </time>
  );
}
