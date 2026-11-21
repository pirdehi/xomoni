'use client';

import { Button, Link, makeStyles, tokens } from '@fluentui/react-components';
import { useSearchParams } from 'next/navigation';
import { useState, useTransition, type SubmitEvent } from 'react';
import { CONTACT_EMAIL } from '@/shared/config/site';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES, type AuthFailure } from '../domain/auth-error';
import { ROUTES } from '../domain/routes';
import { RECOVERY_COOL_DOWN_DAYS } from '../domain/two-factor';
import { SubmitButton, TextField } from './fields';
import { FormAlert } from './form-alert';
import { loadPage } from './navigation';

const useStyles = makeStyles({
  form: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  help: {
    margin: 0,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
  },
  summary: {
    cursor: 'pointer',
    color: tokens.colorBrandForegroundLink,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
  },
  details: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    paddingTop: tokens.spacingVerticalS,
  },
  signOut: { display: 'flex', justifyContent: 'center' },
});

/**
 * The code field every two-step form shares: one-time-code autofill, a numeric keypad on phones, spaces allowed as
 * apps show them ("123 456").
 */
export function CodeField({
  label = '6-digit code',
  error,
  autoFocus,
}: {
  label?: string;
  error?: string;
  /** For a page whose one purpose is the code; it also brings the focus back after a wrong one. */
  autoFocus?: boolean;
}) {
  return (
    <TextField
      label={label}
      autoFocus={autoFocus}
      name="code"
      autoComplete="one-time-code"
      inputMode="numeric"
      pattern="[0-9 ]*"
      maxLength={9}
      spellCheck={false}
      required
      error={error}
      hint="From your authenticator app. A new one shows every 30 seconds."
    />
  );
}

/** What to do when every authenticator app is lost (ADR-0036): write from the account's address. */
export function LostAppHelp({ email }: { email: string }) {
  const s = useStyles();
  return (
    <details>
      <summary className={s.summary}>Lost your authenticator app?</summary>
      <div className={s.details}>
        <p className={s.help}>
          Write to <Link href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</Link> from{' '}
          {email || 'your account’s address'}. To make sure it’s you, we send a message to that address and ask you to
          sign in once more with your password or Google.
        </p>
        <p className={s.help}>
          We then remove your authenticator apps after {RECOVERY_COOL_DOWN_DAYS} days, and tell that address while we
          wait, so nobody else can do this quietly. Nothing on X or in Xomoni on your computer changes.
        </p>
      </div>
    </details>
  );
}

/**
 * The code after sign-in (#173): one field, tried against each of the account's apps, then on to the page that asked
 * (`?next=`, same-site only). Also offers the way back in without the app, and signing out.
 */
export function TwoFactorForm({ email }: { email: string }) {
  const s = useStyles();
  const next = useSearchParams().get('next');
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  // A new key empties the field after a failed code, ready for the next one.
  const [formKey, setFormKey] = useState(0);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await browserAuth.verifySecondFactor({ code: form.get('code'), next });
      if (result.ok) {
        loadPage(result.next);
        return;
      }
      setFailure(result);
      if (result.code !== 'invalid_input') setFormKey((k) => k + 1);
    });
  }

  return (
    <div className={s.form}>
      <p className={s.help}>
        Signing in as <strong>{email}</strong>.
      </p>
      <form key={formKey} onSubmit={onSubmit} noValidate className={s.form}>
        <CodeField error={failure?.fieldErrors?.code} autoFocus />
        <SubmitButton pending={pending}>Verify</SubmitButton>
        {failure && failure.code !== 'invalid_input' && <FormAlert message={AUTH_ERROR_MESSAGES[failure.code]} />}
      </form>
      <LostAppHelp email={email} />
      <form action={ROUTES.signOut} method="post" className={s.signOut}>
        <Button type="submit" appearance="subtle">
          Sign out
        </Button>
      </form>
    </div>
  );
}
