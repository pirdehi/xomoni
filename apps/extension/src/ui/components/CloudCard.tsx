import { Body1, Input, Link, makeStyles, tokens } from '@fluentui/react-components';
import {
  Checkmark20Regular,
  CloudOff20Regular,
  ErrorCircle16Regular,
  Link20Regular,
  Open12Regular,
} from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { CloudError } from '../../cloud/client';
import { PAIRING_PAGE } from '../../cloud/config';
import { type CloudConnection, getConnection, watchConnection } from '../../cloud/connection';
import { FORGOTTEN_HERE, confirmConnection, connect, disconnect } from '../../cloud/sync';
import { errorMessage, fmtDateTime } from '../format';
import { toast } from '../hooks';
import { Button, Card, Field } from './ui';

const useStyles = makeStyles({
  connected: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
  },
  text: { margin: 0, color: tokens.colorNeutralForeground2 },
  device: { fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground1 },
  form: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  external: { display: 'inline-flex', alignItems: 'center', columnGap: tokens.spacingHorizontalXXS },
  fields: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: tokens.spacingHorizontalM,
    '@media (min-width: 640px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  },
  input: { width: '100%' },
  code: { fontFamily: tokens.fontFamilyMonospace, textTransform: 'uppercase' },
  action: { alignSelf: 'flex-start' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  error: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalXS,
    margin: 0,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorStatusDangerForeground1,
  },
  errorIcon: { flexShrink: 0, marginTop: '1px' },
});

/** "Chrome on macOS", from the browser's own description of itself, as a default name for this device. */
export function suggestedDeviceName(userAgent = navigator.userAgent): string {
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Brave/.test(userAgent) ? 'Brave' : 'Chrome';
  const os = /Mac OS X/.test(userAgent)
    ? 'macOS'
    : /Windows/.test(userAgent)
      ? 'Windows'
      : /CrOS/.test(userAgent)
        ? 'ChromeOS'
        : /Linux/.test(userAgent)
          ? 'Linux'
          : '';
  return os ? `${browser} on ${os}` : browser;
}

/** The stored xomoni.com connection, kept current as it changes; undefined while loading. */
export function useConnection(): CloudConnection | null | undefined {
  const [connection, setConnection] = useState<CloudConnection | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    // Called at once and after every change; a read that fails after the card is gone is of no interest.
    const load = () =>
      void getConnection().then(
        (c) => {
          if (alive) setConnection(c);
        },
        (err: unknown) => {
          if (alive) console.warn('[xomoni] could not read the xomoni.com connection', err);
        },
      );
    const stop = watchConnection(load);
    return () => {
      alive = false;
      stop();
    };
  }, []);
  return connection;
}

/**
 * Settings card that connects this browser to a xomoni.com account with a one-time code (ADR-0018), so its jobs'
 * status shows on the website; or shows the connection and disconnects it. After pairing it names the account,
 * masked, and sends nothing until the person confirms it is theirs (#149). It says what is sent: status only. Drawn
 * with Fluent UI (ADR-0019); a refused code is announced as an alert (`role="alert"`).
 */
export function CloudCard() {
  const styles = useStyles();
  const connection = useConnection();
  const [code, setCode] = useState('');
  const [name, setName] = useState(() => suggestedDeviceName());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await connect(code, name);
      setCode('');
    } catch (err) {
      setError(err instanceof CloudError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async () => {
    setBusy(true);
    try {
      await confirmConnection();
      toast('Connected to xomoni.com: job status is sent from now on', 'good');
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    setBusy(true);
    try {
      if ((await disconnect()) === 'forgotten-here') setError(FORGOTTEN_HERE);
      else toast('Disconnected from xomoni.com');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="xomoni.com"
      subtitle="Follow your jobs from any device. Only their status is sent: titles, states and counts, never what you posted or liked."
    >
      {connection && !connection.confirmed ? (
        <div className={styles.form} role="group" aria-label="Confirm the account">
          <Body1 as="p" block className={styles.text}>
            The code linked this browser to the xomoni.com account{' '}
            <strong className={styles.device}>{connection.account || 'that made it'}</strong>. Is that your account?
            Nothing is sent until you say so. If it isn’t yours, someone gave you their code: disconnect.
          </Body1>
          <div className={styles.actions}>
            <Button variant="primary" icon={<Checkmark20Regular />} disabled={busy} onClick={() => void onConfirm()}>
              Yes, it’s mine
            </Button>
            <Button icon={<CloudOff20Regular />} disabled={busy} onClick={() => void onDisconnect()}>
              No, disconnect
            </Button>
          </div>
        </div>
      ) : connection ? (
        <div className={styles.connected}>
          <Body1 as="p" block className={styles.text}>
            Connected as <strong className={styles.device}>{connection.deviceName}</strong>
            {connection.account && (
              <>
                {' '}
                to <strong className={styles.device}>{connection.account}</strong>
              </>
            )}{' '}
            since {fmtDateTime(connection.connectedAt)}.
          </Body1>
          <Button icon={<CloudOff20Regular />} disabled={busy} onClick={() => void onDisconnect()}>
            Disconnect
          </Button>
        </div>
      ) : connection === null ? (
        <div className={styles.form}>
          <Body1 as="p" block className={styles.text}>
            Sign in on xomoni.com and get a one-time code, then type it here.{' '}
            <Link href={PAIRING_PAGE} target="_blank" rel="noreferrer" inline className={styles.external}>
              Get a code <Open12Regular />
            </Link>
          </Body1>
          <div className={styles.fields}>
            <Field label="Code">
              <Input
                className={styles.input}
                input={{ className: styles.code }}
                value={code}
                placeholder="XXXXX-XXXXX"
                autoComplete="off"
                spellCheck={false}
                onChange={(_, data) => setCode(data.value)}
              />
            </Field>
            <Field label="This browser’s name">
              <Input className={styles.input} value={name} maxLength={80} onChange={(_, data) => setName(data.value)} />
            </Field>
          </div>
          <Button
            variant="primary"
            icon={<Link20Regular />}
            className={styles.action}
            disabled={busy || code.replace(/[\s-]/g, '').length !== 10}
            onClick={() => void onConnect()}
          >
            Connect
          </Button>
          {error && (
            <p role="alert" className={styles.error} data-tone="critical">
              <ErrorCircle16Regular className={styles.errorIcon} />
              {error}
            </p>
          )}
        </div>
      ) : null}
    </Card>
  );
}
