'use client';

import { makeStyles, tokens } from '@fluentui/react-components';
import { useState, useTransition, type SubmitEvent } from 'react';
import { CaptchaStatus, useCaptcha } from '@/modules/auth/ui/captcha';
import { PasswordField, SubmitButton, TextField } from '@/modules/auth/ui/fields';
import { FormAlert } from '@/modules/auth/ui/form-alert';
import { loadPage, useSignedInNavigation } from '@/modules/auth/ui/navigation';
import { browserConsole } from '../client/console-sign-in';
import { CONSOLE_SIGN_IN_MESSAGES, type ConsoleSignInProblem } from '../domain/sign-in';

const useStyles = makeStyles({
  form: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
});

/**
 * The console's sign-in (#516): email, password and the security check; no Google and no sign-up. Wrong details and an
 * account that isn't a super-admin get the same answer, and such an account is signed out again at once. `next` is
 * where to go (a console page, checked on the server), `twoFactor` the code page that returns there, for an account
 * with an authenticator app.
 */
export function ConsoleSignInForm({ next, twoFactor }: { next: string; twoFactor: string }) {
  const s = useStyles();
  const navigate = useSignedInNavigation();
  const captcha = useCaptcha('console_sign_in');
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<ConsoleSignInProblem | null>(null);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = { email: form.get('email'), password: form.get('password'), captchaToken: captcha.token };
    setProblem(null);
    startTransition(async () => {
      const result = await browserConsole.signIn(input);
      captcha.reset();
      if (!result.ok) setProblem(result.problem);
      // The code page is a full load, as after any sign-in that owes a code (#173).
      else if (result.secondFactor) loadPage(twoFactor);
      else navigate(next);
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className={s.form}>
      <TextField label="Email" name="email" type="email" autoComplete="username" required />
      <PasswordField label="Password" name="password" autoComplete="current-password" required />
      {captcha.widget}
      <SubmitButton pending={pending} disabled={!captcha.token}>
        Open the console
      </SubmitButton>
      <CaptchaStatus captcha={captcha} />
      {problem && <FormAlert message={CONSOLE_SIGN_IN_MESSAGES[problem]} />}
    </form>
  );
}
