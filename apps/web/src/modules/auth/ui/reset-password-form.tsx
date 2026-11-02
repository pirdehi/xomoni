'use client';

import { useState, useTransition, type SubmitEvent } from 'react';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES, type AuthFailure } from '../domain/auth-error';
import { ROUTES } from '../domain/routes';
import { PasswordField, SubmitButton } from './fields';
import { FormAlert } from './form-alert';
import { useSignedInNavigation } from './navigation';

/** Sets a new password after a reset link signed the person in, then opens their account page. */
export function ResetPasswordForm({ email }: { email: string }) {
  const navigate = useSignedInNavigation();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<AuthFailure | null>(null);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await browserAuth.setNewPassword({ password: form.get('password') });
      if (result.ok) navigate(`${ROUTES.account}?password=updated`);
      else setFailure(result);
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {/* Lets password managers save the new password against the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <PasswordField
        label="New password"
        name="password"
        autoComplete="new-password"
        required
        policy
        error={failure?.fieldErrors?.password}
      />
      <SubmitButton pending={pending}>Save new password</SubmitButton>
      {failure && failure.code !== 'invalid_input' && <FormAlert message={AUTH_ERROR_MESSAGES[failure.code]} />}
    </form>
  );
}
