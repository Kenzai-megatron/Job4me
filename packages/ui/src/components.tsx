import { clsx } from 'clsx';
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useId,
  useRef,
} from 'react';

// Components follow the 8 px grid, 44 px touch targets and visible focus (WCAG 2.2 AA).

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  block?: boolean;
}

export function Button({
  variant = 'primary',
  loading = false,
  block = false,
  className,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-base font-semibold transition-colors motion-reduce:transition-none',
        'disabled:cursor-not-allowed disabled:opacity-60',
        focusRing,
        block && 'w-full',
        variant === 'primary' && 'bg-accent text-on-accent hover:bg-accent-hover',
        variant === 'secondary' &&
          'border border-line-strong bg-surface text-ink hover:bg-surface-muted',
        variant === 'ghost' && 'text-accent hover:bg-accent-soft',
        variant === 'danger' && 'border border-danger bg-surface text-danger hover:bg-danger-soft',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none',
        className,
      )}
    />
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | null;
}

export function TextField({ label, hint, error, className, id, ...rest }: TextFieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <label htmlFor={inputId} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={clsx(
          'min-h-11 rounded-md border bg-surface px-3 text-base text-ink placeholder:text-muted',
          focusRing,
          error ? 'border-danger' : 'border-line-strong',
        )}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Label, hint and error shared by the form fields below (same layout as TextField). */
function FieldFrame({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  className?: string;
  children: (describedBy: string | undefined) => ReactNode;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children(describedBy || undefined)}
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string | null;
  options: { value: string; label: string }[];
  /** Text of an empty first choice; without it, a value is required. */
  emptyLabel?: string;
}

export function SelectField({
  label,
  hint,
  error,
  className,
  id,
  options,
  emptyLabel,
  ...rest
}: SelectFieldProps) {
  const generated = useId();
  const selectId = id ?? generated;
  return (
    <FieldFrame id={selectId} label={label} hint={hint} error={error} className={className}>
      {(describedBy) => (
        <select
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={clsx(
            'min-h-11 rounded-md border bg-surface px-3 text-base text-ink',
            focusRing,
            error ? 'border-danger' : 'border-line-strong',
          )}
          {...rest}
        >
          {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldFrame>
  );
}

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string | null;
}

export function TextAreaField({ label, hint, error, className, id, ...rest }: TextAreaFieldProps) {
  const generated = useId();
  const areaId = id ?? generated;
  return (
    <FieldFrame id={areaId} label={label} hint={hint} error={error} className={className}>
      {(describedBy) => (
        <textarea
          id={areaId}
          rows={4}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={clsx(
            'rounded-md border bg-surface px-3 py-2 text-base text-ink placeholder:text-muted',
            focusRing,
            error ? 'border-danger' : 'border-line-strong',
          )}
          {...rest}
        />
      )}
    </FieldFrame>
  );
}

export interface CheckboxFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
}

/** A checkbox with its label on the right, 44 px tall to stay easy to tap. */
export function CheckboxField({ label, className, id, ...rest }: CheckboxFieldProps) {
  const generated = useId();
  const boxId = id ?? generated;
  return (
    <div className={clsx('flex min-h-11 items-center gap-3', className)}>
      <input
        id={boxId}
        type="checkbox"
        className={clsx('size-5 rounded border-line-strong accent-accent', focusRing)}
        {...rest}
      />
      <label htmlFor={boxId} className="text-base">
        {label}
      </label>
    </div>
  );
}

/** Several choices from a list, as checkboxes grouped under one legend. */
export function CheckboxGroup({
  legend,
  options,
  value,
  onChange,
  className,
}: {
  legend: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (value: string[]) => void;
  className?: string;
}) {
  return (
    <fieldset className={clsx('flex flex-col gap-1', className)}>
      <legend className="text-sm font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-x-6">
        {options.map((option) => (
          <CheckboxField
            key={option.value}
            label={option.label}
            checked={value.includes(option.value)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...value, option.value]
                  : value.filter((item) => item !== option.value),
              )
            }
          />
        ))}
      </div>
    </fieldset>
  );
}

export function Card({
  children,
  className,
  as: Tag = 'section',
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
  'aria-labelledby'?: string;
}) {
  return (
    <Tag
      className={clsx('rounded-lg border border-line bg-surface p-4 sm:p-6', className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export type AlertTone = 'info' | 'error';

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={clsx(
        'rounded-md border px-4 py-3 text-sm',
        tone === 'error'
          ? 'border-danger bg-danger-soft text-ink'
          : 'border-accent-soft bg-accent-soft text-ink',
      )}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={clsx(title && 'mt-1')}>{children}</div> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent';
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold',
        tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-surface-muted text-muted',
      )}
    >
      {children}
    </span>
  );
}

export type ScoreBand = 'band80' | 'band60' | 'band40' | 'band0';

export function scoreBand(score: number): ScoreBand {
  if (score >= 80) return 'band80';
  if (score >= 60) return 'band60';
  if (score >= 40) return 'band40';
  return 'band0';
}

const BAND_CLASSES: Record<ScoreBand, string> = {
  band80: 'border-score-80 text-score-80',
  band60: 'border-score-60 text-score-60',
  band40: 'border-score-40 text-score-40',
  band0: 'border-score-0 text-score-0',
};

/** Score pill: the colour is never alone, the number and the label always come with it. */
export function ScoreBadge({ score, label }: { score: number; label: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-2 rounded-md border-2 bg-surface px-2 py-0.5 text-sm font-semibold tabular-nums',
        BAND_CLASSES[scoreBand(score)],
      )}
    >
      <span>{score}</span>
      <span className="font-medium text-ink">{label}</span>
    </span>
  );
}

/** Typographic logo: "Job4me", the 4 in the accent colour. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx('text-xl font-bold tracking-tight text-ink', className)}>
      Job<span className="text-accent">4</span>me
    </span>
  );
}

/** Modal dialog built on the native <dialog> element (focus trap and Escape for free). */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
