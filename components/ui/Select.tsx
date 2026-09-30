import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { FIELD_CLASS } from './Input';

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  /** Visible label above the field. */
  label: ReactNode;
  /** Error text shown below in red; also sets aria-invalid. */
  error?: string | null;
  /** Defaults to a generated id; the label is always bound to it. */
  id?: string;
  /** Applied to the wrapper (label + field + message), e.g. for layout. */
  className?: string;
  /** The <option> elements. */
  children: ReactNode;
};

export function Select({ label, error, id, className, children, ...selectProps }: SelectProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = `${fieldId}-error`;

  return (
    <div className={['flex flex-col gap-1.5', className].filter(Boolean).join(' ')}>
      <label htmlFor={fieldId} className="text-sm font-semibold text-fg">
        {label}
      </label>
      <select
        {...selectProps}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`${FIELD_CLASS} cursor-pointer`}
      >
        {children}
      </select>
      {error && (
        <p id={errorId} className="text-sm font-medium text-red-alliance-text">
          {error}
        </p>
      )}
    </div>
  );
}
