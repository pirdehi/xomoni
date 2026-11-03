'use client';

import { Button, makeStyles, tokens } from '@fluentui/react-components';
import { useState, useTransition, type SubmitEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES, type AuthFailure } from '../domain/auth-error';
import { ROUTES } from '../domain/routes';
import { AuthLink } from './auth-card';
import { CaptchaStatus, useCaptcha } from './captcha';
import { PasswordField, SubmitButton, TextField } from './fields';
import { FormAlert } from './form-alert';
import { useSignedInNavigation } from './navigation';

const useStyles = makeStyles({
  form: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  password: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS },
  forgot: { margin: 0, fontSize: tokens.fontSizeBase300, textAlign: 'right' },
  wide: { width: '100%' },
});

/** Email and password sign-in. Offers to resend the confirmation link when the email isn't confirmed yet. */
export function SignInForm() {
  const s = useStyles();
  const next = useSearchParams().get('next');
  const navigate = useSignedInNavigation();
  const captcha = useCaptcha('sign_in');
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = { email: form.get('email'), password: form.get('password'), next, captchaToken: captcha.token };
    setEmail(typeof input.email === 'string' ? input.email : '');
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
    <form onSubmit={onSubmit} noValidate className={s.form}>
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={failure?.fieldErrors?.email}
      />
      <div className={s.password}>
        <PasswordField
          label="Password"
          name="password"
          autoComplete="current-password"
          required
          error={failure?.fieldErrors?.password}
        />
        <p className={s.forgot}>
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
        <Button className={s.wide} onClick={resend} disabled={pending || !captcha.token}>
          Send the confirmation link again
        </Button>
      )}
      {notice && <FormAlert tone="info" message={notice} />}
    </form>
  );
}
