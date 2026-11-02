'use client';

import { useState, useTransition, type SubmitEvent } from 'react';
import { MailCheck } from 'lucide-react';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES, type AuthFailure } from '../domain/auth-error';
import { CaptchaStatus, useCaptcha } from './captcha';
import { PasswordField, SubmitButton, TextField } from './fields';
import { FormAlert } from './form-alert';

/**
 * Creates an account with email and password, then asks the person to confirm their address.
 * The success screen is the same whether or not the address already had an account.
 */
export function SignUpForm() {
  const captcha = useCaptcha('sign_up');
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await browserAuth.signUp({
        name: form.get('name'),
        email: form.get('email'),
        password: form.get('password'),
        captchaToken: captcha.token,
      });
      captcha.reset();
      if (result.ok) {
        setFailure(null);
        setSentTo(result.email);
      } else setFailure(result);
    });
  }

  function resend() {
    startTransition(async () => {
      const result = await browserAuth.resendConfirmation({ email: sentTo, captchaToken: captcha.token });
      captcha.reset();
      if (result.ok) setResent(true);
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
          We sent a confirmation link to <strong className="font-medium text-ink">{sentTo}</strong>. Open it to finish
          creating your account. It expires in 1 hour.
        </p>
        <p className="mt-4 text-sm text-muted">Didn’t get it? Check spam, or send it again.</p>
        {captcha.widget}
        <button
          type="button"
          onClick={resend}
          disabled={pending || !captcha.token || resent}
          className="btn btn-secondary mt-3 w-full"
        >
          {resent ? 'Sent again' : 'Send the link again'}
        </button>
        {!resent && <CaptchaStatus captcha={captcha} />}
        {failure && <FormAlert message={AUTH_ERROR_MESSAGES[failure.code]} />}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <TextField
        label="Name (optional)"
        name="name"
        autoComplete="name"
        maxLength={80}
        error={failure?.fieldErrors?.name}
      />
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={failure?.fieldErrors?.email}
      />
      <PasswordField
        label="Password"
        name="password"
        autoComplete="new-password"
        required
        policy
        error={failure?.fieldErrors?.password}
      />
      {captcha.widget}
      <SubmitButton pending={pending} disabled={!captcha.token}>
        Create account
      </SubmitButton>
      <CaptchaStatus captcha={captcha} />
      {failure && failure.code !== 'invalid_input' && <FormAlert message={AUTH_ERROR_MESSAGES[failure.code]} />}
    </form>
  );
}
