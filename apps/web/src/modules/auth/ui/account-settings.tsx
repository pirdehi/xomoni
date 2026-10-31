'use client';

import { useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES, type AuthFailure } from '../domain/auth-error';
import { ROUTES } from '../domain/routes';
import type { AccountDetails } from '../domain/viewer';
import { CaptchaStatus, useCaptcha } from './captcha';
import { PasswordField, SubmitButton, TextField } from './fields';
import { FormAlert } from './form-alert';

const NOTICES: Record<string, string> = {
  'password=updated': 'Your new password is saved.',
  'email=confirmed': 'Email confirmed. If you are changing your address, confirm from the other inbox too.',
};

/**
 * The account page: sign-in email, password, sign-out here or everywhere. Account deletion is a separate
 * section.
 */
export function AccountSettings({ account }: { account: AccountDetails }) {
  const params = useSearchParams();
  const notice = Object.entries(NOTICES).find(([key]) => {
    const [k, v] = key.split('=');
    return params.get(k) === v;
  })?.[1];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
          <p className="mt-1 text-sm text-muted">
            Signed in as <span className="font-medium text-ink">{account.email}</span>
            {account.signInMethods.length > 0 && <> · Sign-in methods: {account.signInMethods.join(', ')}</>}
          </p>
        </div>
        <form action={ROUTES.signOut} method="post">
          <button type="submit" className="btn btn-secondary py-2">
            <LogOut className="size-4" aria-hidden />
            Sign out
          </button>
        </form>
      </div>
      {notice && <FormAlert tone="info" message={notice} />}
      <ChangeEmail account={account} />
      <ChangePassword account={account} />
      <Sessions />
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  const id = title.toLowerCase().replace(/\W+/g, '-');
  return (
    <section className="card p-6" aria-labelledby={id}>
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-2">{description}</p>
      <div className="mt-5 max-w-sm">{children}</div>
    </section>
  );
}

function Sessions() {
  return (
    <Section
      title="Sessions"
      description="Signed in on a computer you no longer use? This signs out every browser where your account is open, this one included. The others can't renew their session, and anything still open there stops working within the hour."
    >
      <form action={`${ROUTES.signOut}?scope=everywhere`} method="post">
        <button type="submit" className="btn btn-secondary py-2">
          <LogOut className="size-4" aria-hidden />
          Sign out everywhere
        </button>
      </form>
    </Section>
  );
}

function ChangeEmail({ account }: { account: AccountDetails }) {
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await browserAuth.changeEmail({ email: form.get('email') });
      if (result.ok) {
        setFailure(null);
        setSentTo(result.email);
      } else setFailure(result);
    });
  }

  const pendingEmail = sentTo ?? account.pendingEmail;
  return (
    <Section
      title="Sign-in email"
      description="We send a confirmation link to both your current and your new address. The change takes effect when both are confirmed."
    >
      {pendingEmail && (
        <FormAlert
          tone="info"
          message={`Waiting for confirmation: ${account.email} → ${pendingEmail}. Open the links in both inboxes.`}
        />
      )}
      <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
        <TextField
          label="New email"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={failure?.fieldErrors?.email}
        />
        <SubmitButton pending={pending}>Change email</SubmitButton>
        {failure && failure.code !== 'invalid_input' && <FormAlert message={AUTH_ERROR_MESSAGES[failure.code]} />}
      </form>
    </Section>
  );
}

function ChangePassword({ account }: { account: AccountDetails }) {
  const captcha = useCaptcha('change_password');
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setNotice(null);
    startTransition(async () => {
      const result = await browserAuth.changePassword({
        currentPassword: form.get('currentPassword'),
        newPassword: form.get('newPassword'),
        captchaToken: captcha.token,
      });
      captcha.reset();
      if (result.ok) {
        setFailure(null);
        setNotice('Your new password is saved.');
        formElement.reset();
      } else setFailure(result);
    });
  }

  function emailLink() {
    setNotice(null);
    startTransition(async () => {
      const result = await browserAuth.requestPasswordReset({ email: account.email, captchaToken: captcha.token });
      captcha.reset();
      if (result.ok) {
        setFailure(null);
        setNotice(`We sent a link to ${result.email} to choose a new password.`);
      } else setFailure(result);
    });
  }

  return (
    <Section
      title="Password"
      description={
        <>
          Enter your current password to choose a new one. Signed up with Google, or don’t remember it?{' '}
          <button
            type="button"
            onClick={emailLink}
            disabled={pending || !captcha.token}
            className="font-medium text-accent underline-offset-2 hover:underline disabled:opacity-60"
          >
            Email me a link to set a password
          </button>
          .
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <input type="email" name="username" autoComplete="username" value={account.email} readOnly hidden />
        <PasswordField
          label="Current password"
          name="currentPassword"
          autoComplete="current-password"
          required
          error={failure?.fieldErrors?.currentPassword}
        />
        <PasswordField
          label="New password"
          name="newPassword"
          autoComplete="new-password"
          required
          policy
          error={failure?.fieldErrors?.newPassword}
        />
        {captcha.widget}
        <SubmitButton pending={pending} disabled={!captcha.token}>
          Change password
        </SubmitButton>
        <CaptchaStatus captcha={captcha} />
        {failure && failure.code !== 'invalid_input' && <FormAlert message={AUTH_ERROR_MESSAGES[failure.code]} />}
        {notice && <FormAlert tone="info" message={notice} />}
      </form>
    </Section>
  );
}
