'use client';

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Add20Regular, Delete20Regular, Phone20Regular } from '@fluentui/react-icons';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type SubmitEvent } from 'react';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES, type AuthFailure } from '../domain/auth-error';
import { ROUTES, twoFactorPath } from '../domain/routes';
import {
  FACTOR_NAME_MAX,
  defaultFactorName,
  groupSecret,
  type SecondFactor,
  type TotpEnrollment,
} from '../domain/two-factor';
import { AccountSection } from './account-layout';
import { SubmitButton, TextField } from './fields';
import { FormAlert } from './form-alert';
import { CodeField, LostAppHelp } from './two-factor-form';

/** The QR code's side, in CSS pixels: big enough for a phone camera at arm's length. */
const QR_SIZE = 176;

const useStyles = makeStyles({
  list: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, margin: 0, padding: 0 },
  item: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    listStyleType: 'none',
  },
  itemText: { display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 },
  itemName: { color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold, overflowWrap: 'anywhere' },
  itemDate: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  form: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL, maxWidth: '384px' },
  steps: {
    margin: 0,
    paddingLeft: tokens.spacingHorizontalXL,
    color: tokens.colorNeutralForeground2,
    listStyleType: 'decimal',
  },
  step: { marginBottom: tokens.spacingVerticalS, lineHeight: tokens.lineHeightBase300 },
  qr: {
    alignSelf: 'flex-start',
    display: 'block',
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusLarge,
    // The code is black on white in both themes: a camera reads it reliably only that way round.
    backgroundColor: '#ffffff',
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  secret: {
    margin: 0,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase300,
    letterSpacing: '0.05em',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  label: { margin: 0, color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase300 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  dialogText: { margin: 0 },
});

const ADDED = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });

/** What the section shows below its list. */
type Panel = { step: 'idle' } | { step: 'name' } | { step: 'scan'; enrollment: TotpEnrollment };

/**
 * "Two-step verification" on the account page (#173, ADR-0036): the account's authenticator apps, adding one (a name,
 * then the QR code and its key, shown once, then its first code) and removing one after a confirmation. Adding the
 * first turns two-step verification on; removing the last turns it off. Every change is emailed to the account.
 */
export function TwoFactorSection({ email, factors }: { email: string; factors: SecondFactor[] }) {
  const s = useStyles();
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>({ step: 'idle' });
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SecondFactor | null>(null);
  const on = factors.length > 0;

  function begin() {
    setNotice(null);
    setFailure(null);
    setPanel({ step: 'name' });
  }

  function onName(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await browserAuth.startEnrollment({ name: form.get('name') });
      if (result.ok) {
        setFailure(null);
        setPanel({ step: 'scan', enrollment: result.enrollment });
      } else setFailure(result);
    });
  }

  function onCode(event: SubmitEvent<HTMLFormElement>, enrollment: TotpEnrollment) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await browserAuth.confirmEnrollment({ factorId: enrollment.factorId, code: form.get('code') });
      if (!result.ok) {
        setFailure(result);
        return;
      }
      setFailure(null);
      setPanel({ step: 'idle' });
      setNotice(
        on
          ? 'Your new authenticator app is added. Either app’s code now works when you sign in.'
          : 'Two-step verification is on. Signing in now asks for a code from your app. Add a second app on another device too, in case you lose this one.',
      );
      router.refresh();
    });
  }

  function cancel() {
    const current = panel;
    setPanel({ step: 'idle' });
    setFailure(null);
    if (current.step !== 'scan') return;
    // The app was never confirmed; dropping it keeps the account as it was. Supabase clears it later regardless.
    startTransition(async () => {
      await browserAuth.cancelEnrollment(current.enrollment.factorId);
    });
  }

  function remove(factor: SecondFactor) {
    setRemoving(null);
    setNotice(null);
    startTransition(async () => {
      const result = await browserAuth.removeSecondFactor(factor.id);
      if (!result.ok) {
        setFailure(result);
        return;
      }
      setFailure(null);
      setNotice(
        factors.length > 1
          ? `${factor.name} is removed. Its codes no longer work.`
          : `${factor.name} is removed, and two-step verification is off. Signing in asks only for your password or Google.`,
      );
      router.refresh();
    });
  }

  return (
    <AccountSection
      title="Two-step verification"
      wide
      description={
        on
          ? 'On. Signing in asks for a 6-digit code from one of these apps after your password or Google, so your password alone isn’t enough.'
          : 'Off. Add an authenticator app, such as 1Password, Google Authenticator or Microsoft Authenticator. Signing in then also asks for a 6-digit code from it, so your password alone isn’t enough.'
      }
    >
      {on && (
        <ul className={s.list} aria-label="Your authenticator apps">
          {factors.map((factor) => (
            <li key={factor.id} className={s.item}>
              <Phone20Regular aria-hidden />
              <span className={s.itemText}>
                <span className={s.itemName}>{factor.name}</span>
                <span className={s.itemDate}>Added {ADDED.format(new Date(factor.addedAt))}</span>
              </span>
              <Button
                icon={<Delete20Regular />}
                onClick={() => setRemoving(factor)}
                disabled={pending}
                aria-label={`Remove ${factor.name}`}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {panel.step === 'idle' && (
        <div className={s.actions}>
          <Button icon={<Add20Regular />} onClick={begin} disabled={pending} appearance={on ? 'secondary' : 'primary'}>
            {on ? 'Add another authenticator app' : 'Turn on two-step verification'}
          </Button>
        </div>
      )}

      {panel.step === 'name' && (
        <form onSubmit={onName} noValidate className={s.form} aria-label="Name the authenticator app">
          <TextField
            label="Name this app (optional)"
            name="name"
            autoComplete="off"
            maxLength={FACTOR_NAME_MAX}
            placeholder={defaultFactorName(factors)}
            hint="So you can tell your apps apart, such as “Phone” or “1Password”."
            error={failure?.fieldErrors?.name}
          />
          <div className={s.actions}>
            <SubmitButton pending={pending}>Continue</SubmitButton>
            <Button onClick={cancel} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {panel.step === 'scan' && (
        <form
          onSubmit={(event) => onCode(event, panel.enrollment)}
          noValidate
          className={s.form}
          aria-label="Add the authenticator app"
        >
          <ol className={s.steps}>
            <li className={s.step}>In your authenticator app, add an account and scan this QR code.</li>
            <li className={s.step}>Enter the 6-digit code the app shows for Xomoni.</li>
          </ol>
          <Image
            className={s.qr}
            src={panel.enrollment.qrCode}
            alt="QR code to add Xomoni to your authenticator app"
            width={QR_SIZE}
            height={QR_SIZE}
            unoptimized
          />
          <p className={s.label} id="totp-secret-label">
            Can’t scan it? Type this key instead. It’s shown only now.
          </p>
          <p className={s.secret} aria-labelledby="totp-secret-label" data-testid="totp-secret">
            {groupSecret(panel.enrollment.secret)}
          </p>
          <CodeField error={failure?.fieldErrors?.code} />
          <div className={s.actions}>
            <SubmitButton pending={pending}>{on ? 'Add app' : 'Turn on'}</SubmitButton>
            <Button onClick={cancel} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {failure && failure.code !== 'invalid_input' && <FormAlert message={AUTH_ERROR_MESSAGES[failure.code]} />}
      {failure?.code === 'second_factor_required' && (
        <Button as="a" href={twoFactorPath(ROUTES.account)}>
          Enter a code
        </Button>
      )}
      {notice && <FormAlert tone="info" message={notice} />}
      {on && <LostAppHelp email={email} />}

      {removing && (
        <Dialog open onOpenChange={(_, data) => !data.open && setRemoving(null)}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Remove {removing.name}?</DialogTitle>
              <DialogContent>
                <p className={s.dialogText}>
                  {factors.length > 1
                    ? 'Its codes stop working. Your other authenticator apps still sign you in.'
                    : 'Its codes stop working, and two-step verification turns off: signing in asks only for your password or Google.'}
                </p>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setRemoving(null)}>Cancel</Button>
                <Button appearance="primary" onClick={() => remove(removing)}>
                  Remove
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </AccountSection>
  );
}
