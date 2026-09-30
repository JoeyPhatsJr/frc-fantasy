export type BumperSide = 'blue' | 'red';
export type BumperSize = 'sm' | 'md' | 'lg';

export type BumperPlateProps = {
  /** Team number as shown on the robot, e.g. "341" or "9998B". */
  number: string;
  /** Blue by default; red only for the red side of a match or danger. */
  side?: BumperSide;
  /** sm 28px inline, md 40px rows, lg 56px draft grid. */
  size?: BumperSize;
  className?: string;
};

const SIDES: Record<BumperSide, string> = {
  blue: 'bg-primary-fill',
  red: 'bg-red-alliance',
};

// Width grows with the number; the minimum keeps 1- to 3-digit teams from looking like pills.
const SIZES: Record<BumperSize, string> = {
  sm: 'h-7 min-w-11 px-1.5 text-[17px]',
  md: 'h-10 min-w-14 px-2 text-[26px]',
  lg: 'h-14 min-w-20 px-3 text-[40px]',
};

/** A team number the way robots wear it: bold white numerals on bumper fabric. */
export function BumperPlate({ number, side = 'blue', size = 'md', className }: BumperPlateProps) {
  return (
    <span
      role="img"
      aria-label={`Team ${number}`}
      className={[
        'inline-flex shrink-0 items-center justify-center rounded-plate pt-px shadow-plate',
        'font-display font-bold leading-none tracking-wide text-on-primary tabular-nums',
        SIDES[side],
        SIZES[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {number}
    </span>
  );
}
