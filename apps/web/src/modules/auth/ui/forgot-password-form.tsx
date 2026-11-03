'use client';

import { makeStyles, tokens } from '@fluentui/react-components';
import { useState, useTransition, type SubmitEvent } from 'react';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES, type AuthFailure } from '../domain/auth-error';
import { CaptchaStatus, useCaptcha } from './captcha';
import { SubmitButton, TextField } from './fields';
import { CheckInbox, FormAlert } from './form-alert';

const useStyles = makeStyles({
  form: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
});

/** Requests a password reset link. The answer never says whether the address has an account. */
export function ForgotPasswordForm() {
  const s = useStyles();
  const captcha = useCaptcha('password_reset');
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await browserAuth.requestPasswordReset({ email: form.get('email'), captchaToken: captcha.token });
      captcha.reset();
      if (result.ok) setSentTo(result.email);
      else setFailure(result);
    });
  }

  if (sentTo) {
    return (
      <div role="status">
        <CheckInbox>
          If <strong>{sentTo}</strong> has a Xomoni account, we sent it a link to choose a new password. The link
          expires in 1 hour.
        </CheckInbox>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className={s.form}>
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={failure?.fieldErrors?.email}
      />
      {captcha.widget}
      <SubmitButton pending={pending} disabled={!captcha.token}>
        Send reset link
      </SubmitButton>
      <CaptchaStatus captcha={captcha} />
      {failure && failure.code !== 'invalid_input' && <FormAlert message={AUTH_ERROR_MESSAGES[failure.code]} />}
    </form>
  );
}
