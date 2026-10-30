'use client';

import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { PASSWORD_REQUIREMENTS, passwordIssues, type PasswordIssue } from '../domain/credentials';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'>;

/** A labelled input with an optional hint and an inline error tied to it for screen readers. */
export function TextField({
  label,
  error,
  hint,
  ...input
}: { label: string; error?: string; hint?: ReactNode } & InputProps) {
  const id = useId();
  const described = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        className="field"
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        {...input}
      />
      <FieldNote id={id} error={error} hint={hint} />
    </div>
  );
}

/**
 * A password input with a show/hide toggle. With `policy`, it also shows a live checklist of the
 * password rules, so people see what's missing before they submit.
 */
export function PasswordField({
  label,
  error,
  policy = false,
  ...input
}: { label: string; error?: string; policy?: boolean } & InputProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState('');
  const issues = new Set(passwordIssues(value));
  const shown: PasswordIssue[] = [
    'too_short',
    'needs_letter',
    'needs_digit',
    ...(issues.has('too_long') ? ['too_long' as const] : []),
  ];

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          className="field pr-11"
          aria-invalid={error ? true : undefined}
          aria-describedby={[error && `${id}-error`, policy && `${id}-policy`].filter(Boolean).join(' ') || undefined}
          onInput={(e) => setValue(e.currentTarget.value)}
          {...input}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-[0.625rem] text-muted hover:text-ink"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
      {policy && (
        <ul id={`${id}-policy`} className="mt-2 space-y-1 text-xs" aria-label="Password requirements">
          {shown.map((issue) => {
            const met = value.length > 0 && !issues.has(issue);
            return (
              <li key={issue} className={`flex items-center gap-1.5 ${met ? 'text-good-ink' : 'text-muted'}`}>
                <Check className={`size-3.5 ${met ? '' : 'opacity-30'}`} aria-hidden />
                {PASSWORD_REQUIREMENTS[issue]}
                <span className="sr-only">{met ? '(met)' : '(not met yet)'}</span>
              </li>
            );
          })}
        </ul>
      )}
      <FieldNote id={id} error={error} />
    </div>
  );
}

function FieldNote({ id, error, hint }: { id: string; error?: string; hint?: ReactNode }) {
  if (error)
    return (
      <p id={`${id}-error`} className="mt-1.5 text-sm text-critical">
        {error}
      </p>
    );
  if (hint)
    return (
      <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">
        {hint}
      </p>
    );
  return null;
}

/** The form's main button; shows a spinner and blocks double submits while pending. */
export function SubmitButton({
  pending,
  disabled,
  children,
}: {
  pending: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="submit" disabled={pending || disabled} className="btn btn-primary w-full py-3 text-base">
      {pending && <LoaderCircle className="size-5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
