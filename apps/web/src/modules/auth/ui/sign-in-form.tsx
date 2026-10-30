'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES, type AuthFailure } from '../domain/auth-error';
import { ROUTES } from '../domain/routes';
import { AuthLink } from './auth-card';
import { CaptchaStatus, useCaptcha } from './captcha';
import { PasswordField, SubmitButton, TextField } from './fields';
import { FormAlert } from './form-alert';
import { useSignedInNavigation } from './navigation';

/** Email and password sign-in. Offers to resend the confirmation link when the email isn't confirmed yet. */
export function SignInForm() {
  const next = useSearchParams().get('next');
  const navigate = useSignedInNavigation();
  const captcha = useCaptcha('sign_in');
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = { email: form.get('email'), password: form.get('password'), next, captchaToken: captcha.token };
    setEmail(String(input.email ?? ''));
    setNotice(null);
    startTransition(async () => {
      const result = await browserAuth.signIn(input);
      captcha.reset();
      if (result.ok) navigate(result.next);
      else setFailure(result);
    });
  }

  function resend() {
    startTransition(async () => {
      const result = await browserAuth.resendConfirmation({ email, captchaToken: captcha.token });
      captcha.reset();
      if (result.ok) {
        setFailure(null);
        setNotice(`We sent a new confirmation link to ${result.email}.`);
      } else setFailure(result);
    });
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
      <div>
        <PasswordField
          label="Password"
          name="password"
          autoComplete="current-password"
          required
          error={failure?.fieldErrors?.password}
        />
        <p className="mt-2 text-right text-sm">
          <AuthLink href={ROUTES.forgotPassword}>Forgot password?</AuthLink>
        </p>
      </div>
      {captcha.widget}
      <SubmitButton pending={pending} disabled={!captcha.token}>
        Sign in
      </SubmitButton>
      <CaptchaStatus captcha={captcha} />
      {failure && failure.code !== 'invalid_input' && <FormAlert message={AUTH_ERROR_MESSAGES[failure.code]} />}
      {failure?.code === 'email_not_confirmed' && (
        <button
          type="button"
          onClick={resend}
          disabled={pending || !captcha.token}
          className="btn btn-secondary w-full"
        >
          Send the confirmation link again
        </button>
      )}
      {notice && <FormAlert tone="info" message={notice} />}
    </form>
  );
}
