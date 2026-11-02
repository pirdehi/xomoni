'use client';

import { useState, useTransition, type SubmitEvent } from 'react';
import { MailCheck } from 'lucide-react';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES, type AuthFailure } from '../domain/auth-error';
import { CaptchaStatus, useCaptcha } from './captcha';
import { SubmitButton, TextField } from './fields';
import { FormAlert } from './form-alert';

/** Requests a password reset link. The answer never says whether the address has an account. */
export function ForgotPasswordForm() {
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
        <div className="flex items-center gap-2 text-accent">
          <MailCheck className="size-5" aria-hidden />
          <p className="font-medium">Check your inbox</p>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          If <strong className="font-medium text-ink">{sentTo}</strong> has a Xomoni account, we sent it a link to
          choose a new password. The link expires in 1 hour.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
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
