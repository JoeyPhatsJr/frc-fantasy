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

export const FIELD_CLASS =
  'h-11 w-full rounded-lg border border-fg-muted/40 bg-surface px-3 text-base text-fg ' +
  'placeholder:text-fg-muted motion-safe:transition-colors duration-200 hover:border-fg-muted/70 ' +
  'focus-visible:outline-hidden focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60 ' +
  'aria-invalid:border-red-alliance';

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
        <p id={messageId} className="text-sm font-medium text-red-700">
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
