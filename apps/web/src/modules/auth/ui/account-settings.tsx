'use client';

import { Button, Link, makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import { SignOut20Regular } from '@fluentui/react-icons';
import { useState, useTransition, type SubmitEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES, type AuthFailure } from '../domain/auth-error';
import { ROUTES } from '../domain/routes';
import type { AccountDetails } from '../domain/viewer';
import { AccountSection } from './account-layout';
import { CaptchaStatus, useCaptcha } from './captcha';
import { PasswordField, SubmitButton, TextField } from './fields';
import { FormAlert } from './form-alert';
import { CodeField } from './two-factor-form';
import { TwoFactorSection } from './two-factor-settings';

const useStyles = makeStyles({
  page: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXL },
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalL,
  },
  title: { ...typographyStyles.title2, margin: 0, color: tokens.colorNeutralForeground1 },
  signedIn: {
    margin: `${tokens.spacingVerticalXS} 0 0`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
  },
  email: { color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold },
  form: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
});

const NOTICES: Record<string, string> = {
  'password=updated': 'Your new password is saved.',
  'email=confirmed': 'Email confirmed. If you are changing your address, confirm from the other inbox too.',
};

/**
 * The account page: sign-in email, password, two-step verification (#173), sign-out here or everywhere. Account
 * deletion is a separate section.
 */
export function AccountSettings({ account }: { account: AccountDetails }) {
  const s = useStyles();
  const params = useSearchParams();
  const notice = Object.entries(NOTICES).find(([key]) => {
    const [k = '', v] = key.split('=');
    return params.get(k) === v;
  })?.[1];

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Account</h1>
          <p className={s.signedIn}>
            Signed in as <span className={s.email}>{account.email}</span>
            {account.signInMethods.length > 0 && <> · Sign-in methods: {account.signInMethods.join(', ')}</>}
          </p>
        </div>
        <form action={ROUTES.signOut} method="post">
          <Button type="submit" icon={<SignOut20Regular />}>
            Sign out
          </Button>
        </form>
      </div>
      {notice && <FormAlert tone="info" message={notice} />}
      <ChangeEmail account={account} />
      <ChangePassword account={account} />
      <TwoFactorSection email={account.email} factors={account.secondFactors} />
      <Sessions />
    </div>
  );
}

function Sessions() {
  return (
    <AccountSection
      title="Sessions"
      description="Signed in on a computer you no longer use? This signs out every browser where your account is open, this one included. The others can't renew their session, and anything still open there stops working within the hour."
    >
      <form action={`${ROUTES.signOut}?scope=everywhere`} method="post">
        <Button type="submit" icon={<SignOut20Regular />}>
          Sign out everywhere
        </Button>
      </form>
    </AccountSection>
  );
}

function ChangeEmail({ account }: { account: AccountDetails }) {
  const s = useStyles();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
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
    <AccountSection
      title="Sign-in email"
      description="We send a confirmation link to both your current and your new address. The change takes effect when both are confirmed."
    >
      {pendingEmail && (
        <FormAlert
          tone="info"
          message={`Waiting for confirmation: ${account.email} → ${pendingEmail}. Open the links in both inboxes.`}
        />
      )}
      <form onSubmit={onSubmit} noValidate className={s.form}>
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
    </AccountSection>
  );
}

function ChangePassword({ account }: { account: AccountDetails }) {
  const s = useStyles();
  const captcha = useCaptcha('change_password');
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A new key remounts the fields after a change, clearing their values and the password checklist.
  const [formKey, setFormKey] = useState(0);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setNotice(null);
    startTransition(async () => {
      const result = await browserAuth.changePassword({
        currentPassword: form.get('currentPassword'),
        newPassword: form.get('newPassword'),
        code: form.get('code'),
        captchaToken: captcha.token,
      });
      captcha.reset();
      if (result.ok) {
        setFailure(null);
        setNotice('Your new password is saved.');
        setFormKey((n) => n + 1);
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
    <AccountSection
      title="Password"
      description={
        <>
          Enter your current password
          {account.secondFactors.length > 0 && ' and a code from your authenticator app'} to choose a new one. Signed up
          with Google, or don’t remember it?{' '}
          <Link as="button" inline onClick={emailLink} disabled={pending || !captcha.token}>
            Email me a link to set a password
          </Link>
          .
        </>
      }
    >
      <form key={formKey} onSubmit={onSubmit} noValidate className={s.form}>
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
        {account.secondFactors.length > 0 && (
          <CodeField label="Code from your authenticator app" error={failure?.fieldErrors?.code} />
        )}
        {captcha.widget}
        <SubmitButton pending={pending} disabled={!captcha.token}>
          Change password
        </SubmitButton>
        <CaptchaStatus captcha={captcha} />
        {failure && failure.code !== 'invalid_input' && <FormAlert message={AUTH_ERROR_MESSAGES[failure.code]} />}
        {notice && <FormAlert tone="info" message={notice} />}
      </form>
    </AccountSection>
  );
}
