'use client';
// The auth forms' fields and submit button on Fluent UI (ADR-0019). Labels, errors and hints are wired by hand
// rather than through Fluent's Field, so screen readers read the error first and then the password checklist.

import {
  Button,
  Input,
  Label,
  Spinner,
  makeStyles,
  mergeClasses,
  tokens,
  type InputProps as FluentInputProps,
} from '@fluentui/react-components';
import {
  CheckmarkCircle16Filled,
  Circle16Regular,
  ErrorCircle16Filled,
  Eye20Regular,
  EyeOff20Regular,
} from '@fluentui/react-icons';
import { useId, useState, type ReactNode } from 'react';
import { PASSWORD_REQUIREMENTS, passwordIssues, type PasswordIssue } from '../domain/credentials';

const useStyles = makeStyles({
  field: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS },
  label: { fontWeight: tokens.fontWeightSemibold },
  input: { width: '100%' },
  note: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalXS,
    margin: 0,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
  error: { color: tokens.colorStatusDangerForeground1 },
  hint: { color: tokens.colorNeutralForeground3 },
  noteIcon: { flexShrink: 0, marginTop: '1px' },
  policy: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
    margin: `${tokens.spacingVerticalXS} 0 0`,
    padding: 0,
    listStyleType: 'none',
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
  rule: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground3,
  },
  met: { color: tokens.colorStatusSuccessForeground1 },
  visuallyHidden: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    margin: '-1px',
    padding: 0,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
    border: 0,
  },
  submit: { width: '100%' },
});

/** The native input attributes a field passes through; the field owns its id, look and slots. */
type InputProps = Omit<
  FluentInputProps,
  'id' | 'className' | 'size' | 'appearance' | 'onChange' | 'root' | 'input' | 'contentBefore' | 'contentAfter'
>;

/** A labelled input with an optional hint and an inline error tied to it for screen readers. */
export function TextField({
  label,
  error,
  hint,
  ...input
}: { label: string; error?: string; hint?: ReactNode } & InputProps) {
  const s = useStyles();
  const id = useId();
  const described = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={s.field}>
      <Label htmlFor={id} className={s.label}>
        {label}
      </Label>
      <Input
        id={id}
        size="large"
        className={s.input}
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
  const s = useStyles();
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
    <div className={s.field}>
      <Label htmlFor={id} className={s.label}>
        {label}
      </Label>
      <Input
        id={id}
        size="large"
        className={s.input}
        type={visible ? 'text' : 'password'}
        aria-invalid={error ? true : undefined}
        aria-describedby={[error && `${id}-error`, policy && `${id}-policy`].filter(Boolean).join(' ') || undefined}
        onInput={(e) => setValue(e.currentTarget.value)}
        contentAfter={
          <Button
            appearance="transparent"
            size="small"
            icon={visible ? <EyeOff20Regular /> : <Eye20Regular />}
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
          />
        }
        {...input}
      />
      {policy && (
        <ul id={`${id}-policy`} className={s.policy} aria-label="Password requirements">
          {shown.map((issue) => {
            const met = value.length > 0 && !issues.has(issue);
            const Icon = met ? CheckmarkCircle16Filled : Circle16Regular;
            return (
              <li key={issue} className={mergeClasses(s.rule, met && s.met)} data-met={met}>
                <Icon aria-hidden />
                {PASSWORD_REQUIREMENTS[issue]}
                <span className={s.visuallyHidden}>{met ? '(met)' : '(not met yet)'}</span>
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
  const s = useStyles();
  if (error)
    return (
      <p id={`${id}-error`} className={mergeClasses(s.note, s.error)}>
        <ErrorCircle16Filled className={s.noteIcon} aria-hidden />
        {error}
      </p>
    );
  if (hint)
    return (
      <p id={`${id}-hint`} className={mergeClasses(s.note, s.hint)}>
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
  const s = useStyles();
  return (
    <Button
      type="submit"
      appearance="primary"
      size="large"
      className={s.submit}
      disabled={pending || disabled}
      icon={pending ? <Spinner size="tiny" aria-hidden /> : undefined}
    >
      {children}
    </Button>
  );
}
