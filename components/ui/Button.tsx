import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'md' | 'sm' | 'icon';

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy, and (for <button>) disables it. */
  busy?: boolean;
  className?: string;
  children?: ReactNode;
};

type ButtonAsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & { href?: undefined };

type ButtonAsLink = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps | 'href'> & { href: string };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

const BASE =
  'relative inline-flex items-center justify-center gap-2 rounded-pill font-semibold whitespace-nowrap ' +
  'cursor-pointer select-none motion-safe:transition-colors duration-200 ' +
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-surface ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary-fill text-on-primary hover:bg-primary-strong active:bg-primary-strong',
  accent: 'bg-accent text-on-accent hover:bg-accent-strong active:bg-accent-strong',
  secondary: 'border border-primary/40 bg-surface text-primary hover:border-primary/70 hover:bg-surface-2',
  danger:
    'border border-red-alliance bg-surface text-red-alliance-text hover:bg-red-alliance hover:text-on-primary',
  ghost: 'bg-transparent text-primary hover:bg-primary/10',
};

// `sm` is visually 36px; the ::before pseudo-element extends the hit area to 44px.
const SIZES: Record<ButtonSize, string> = {
  md: 'min-h-11 px-4 text-base',
  sm: 'min-h-9 px-3 text-sm before:absolute before:inset-x-0 before:-inset-y-1',
  // A 44px square for icon-only controls (give it an aria-label). No padding, so the icon is centred.
  icon: 'size-11 shrink-0 p-0 justify-center',
};

/** The classes a <Button> of this variant and size gets, for the rare element that can't be a <Button>. */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md'): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]}`;
}

function Spinner() {
  return (
    <span
      data-spinner
      aria-hidden="true"
      className="size-4 shrink-0 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin"
    />
  );
}

export function Button(props: ButtonProps) {
  if (props.href !== undefined) {
    const { variant = 'primary', size = 'md', busy = false, className, children, href, ...rest } = props;
    const classes = [buttonClass(variant, size), busy && 'pointer-events-none opacity-50', className]
      .filter(Boolean)
      .join(' ');
    return (
      <Link
        {...rest}
        href={href}
        className={classes}
        aria-busy={busy || undefined}
        aria-disabled={busy || undefined}
      >
        {busy && <Spinner />}
        {children}
      </Link>
    );
  }

  const { variant = 'primary', size = 'md', busy = false, className, children, disabled, ...rest } = props;
  const classes = [buttonClass(variant, size), className].filter(Boolean).join(' ');
  return (
    <button {...rest} disabled={disabled || busy} aria-busy={busy || undefined} className={classes}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}
