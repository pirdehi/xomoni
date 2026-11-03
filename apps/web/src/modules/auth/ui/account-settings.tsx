'use client';

import { Button, Link, makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import { SignOut20Regular } from '@fluentui/react-icons';
import { useState, useTransition, type SubmitEvent, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES, type AuthFailure } from '../domain/auth-error';
import { ROUTES } from '../domain/routes';
import type { AccountDetails } from '../domain/viewer';
import { CaptchaStatus, useCaptcha } from './captcha';
import { PasswordField, SubmitButton, TextField } from './fields';
import { FormAlert } from './form-alert';

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
  section: {
    padding: tokens.spacingHorizontalXXL,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadius2XLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
  },
  sectionTitle: { ...typographyStyles.subtitle2, margin: 0, color: tokens.colorNeutralForeground1 },
  sectionText: {
    maxWidth: '672px',
    margin: `${tokens.spacingVerticalXS} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
  },
  sectionBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    maxWidth: '384px',
    marginTop: tokens.spacingVerticalXL,
  },
  form: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
});

const NOTICES: Record<string, string> = {
  'password=updated': 'Your new password is saved.',
  'email=confirmed': 'Email confirmed. If you are changing your address, confirm from the other inbox too.',
};

/**
 * The account page: sign-in email, password, sign-out here or everywhere. Account deletion is a separate
 * section.
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
      <Sessions />
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  const s = useStyles();
  const id = title.toLowerCase().replace(/\W+/g, '-');
  return (
    <section className={s.section} aria-labelledby={id}>
      <h2 id={id} className={s.sectionTitle}>
        {title}
      </h2>
      <p className={s.sectionText}>{description}</p>
      <div className={s.sectionBody}>{children}</div>
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
        <Button type="submit" icon={<SignOut20Regular />}>
          Sign out everywhere
        </Button>
      </form>
    </Section>
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
    </Section>
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
    <Section
      title="Password"
      description={
        <>
          Enter your current password to choose a new one. Signed up with Google, or don’t remember it?{' '}
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
