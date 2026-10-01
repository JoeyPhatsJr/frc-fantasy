import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  /** Visible label above the field. */
  label: ReactNode;
  /** Error text shown below in red; also sets aria-invalid. */
  error?: string | null;
  /** Helper text shown below when there is no error. */
  hint?: ReactNode;
  /** Defaults to a generated id; the label is always bound to it. */
  id?: string;
  /** Applied to the wrapper (label + field + message), e.g. for layout. */
  className?: string;
};

/** Field styling without a width, for fields that size themselves (a number box, a flex-1 input). */
export const FIELD_BASE =
  'h-11 touch-manipulation rounded-lg border border-fg-muted/70 bg-surface-2 px-3 text-base text-fg ' +
  'placeholder:text-fg-muted motion-safe:transition-colors duration-200 hover:border-fg-muted ' +
  'focus-visible:outline-hidden focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring ' +
  'disabled:cursor-not-allowed disabled:border-border disabled:opacity-60 ' +
  'aria-invalid:border-red-alliance';

export const FIELD_CLASS = `w-full ${FIELD_BASE}`;

export function Input({ label, error, hint, id, className, ...inputProps }: InputProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const messageId = `${fieldId}-${error ? 'error' : 'hint'}`;
  const hasMessage = Boolean(error) || hint != null;

  return (
    <div className={['flex flex-col gap-1.5', className].filter(Boolean).join(' ')}>
      <label htmlFor={fieldId} className="text-sm font-semibold text-fg">
        {label}
      </label>
      <input
        {...inputProps}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={hasMessage ? messageId : undefined}
        className={FIELD_CLASS}
      />
      {error ? (
        <p id={messageId} className="text-sm font-medium text-red-alliance-text">
          {error}
        </p>
      ) : (
        hint != null && (
          <p id={messageId} className="text-sm text-fg-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
