import { Body1, Caption1, Input, Link, Switch, makeStyles, tokens } from '@fluentui/react-components';
import {
  Checkmark20Regular,
  CloudOff20Regular,
  Dismiss20Regular,
  ErrorCircle16Regular,
  Link20Regular,
  Open12Regular,
  Open20Regular,
} from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { CloudError } from '../../cloud/client';
import { chooseStats, statsShown } from '../../cloud/daily-report';
import { suggestedDeviceName } from '../../cloud/device-name';
import { type CloudConnection, getConnection, watchConnection } from '../../cloud/connection';
import { ConnectionMap, type XLink } from './ConnectionMap';
import { FORGOTTEN_HERE, confirmConnection, connect, disconnect } from '../../cloud/sync';
import { cancelWebConnect, pendingWebConnect, startWebConnect } from '../../cloud/web-connect';
import { leaveWebsite, websiteLink } from '../../cloud/web-session';
import { errorMessage, fmtDateTime } from '../format';
import { toast } from '../hooks';
import { Button, Card, Disclosure, Field } from './ui';

const useStyles = makeStyles({
  numbers: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalXS, flexBasis: '100%' },
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
  map: { maxWidth: '440px', marginBottom: tokens.spacingVerticalL },
});

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
 * Whether the account shows its daily numbers on xomoni.com, as this browser last heard (#250, ADR-0026); undefined
 * while it is read. This browser sends them only while it is true, so the words about what is sent follow it.
 */
export function useNumbersShown(): boolean | undefined {
  return useLiveQuery(statsShown, []);
}

/**
 * Opens xomoni.com/connect to connect this browser with one click there (#228, ADR-0024); says why when Chrome
 * refuses to open the tab. Call it from a click.
 */
export async function connectOnWebsite(): Promise<void> {
  try {
    await chrome.tabs.create({ url: await startWebConnect(), active: true });
  } catch (err) {
    toast(errorMessage(err), 'critical');
  }
}

/**
 * Settings card that connects this browser to a xomoni.com account, so its jobs' status shows on the website; or
 * shows the connection and disconnects it. Connecting is one click on xomoni.com (#228, ADR-0024): the card opens the
 * page and waits while it is finished there; a one-time code typed here (ADR-0018) stays as the fallback, folded. After pairing it names the account,
 * masked, and sends nothing until the person confirms it is theirs (#149). A `ConnectionMap` on top shows the link as
 * it stands, and moves while a code is being checked. It says what is sent: status, and the daily numbers while
 * they are on. Drawn
 * with Fluent UI (ADR-0019); a refused code is announced as an alert (`role="alert"`).
 */
export function CloudCard({ x = 'unknown' }: { x?: XLink }) {
  const styles = useStyles();
  const connection = useConnection();
  const [code, setCode] = useState('');
  const [name, setName] = useState(() => suggestedDeviceName());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const waiting = useLiveQuery(() => pendingWebConnect(), []);
  const numbers = useNumbersShown() === true;

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
      toast('Connected to xomoni.com: job status is sent from now on, and your daily numbers while they’re on', 'good');
    } finally {
      setBusy(false);
    }
  };

  // Someone else's code (#149): only this link ends; the person's own xomoni.com session isn't theirs to end.
  const onDisconnect = async () => {
    setBusy(true);
    try {
      if ((await disconnect()) === 'forgotten-here') setError(FORGOTTEN_HERE);
      else toast('Disconnected from xomoni.com');
    } finally {
      setBusy(false);
    }
  };

  // The person's own account: signing out of it here signs xomoni.com out in this browser too (#232, ADR-0025).
  const onSignOut = async () => {
    setBusy(true);
    try {
      if ((await leaveWebsite()) === 'forgotten-here') setError(FORGOTTEN_HERE);
      else toast('Signed out of xomoni.com in this browser');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="xomoni.com"
      subtitle="Follow your jobs from any device. Only their status is sent, and your daily numbers if you choose: titles, states and counts, never what you posted or liked."
    >
      <div className={styles.map}>
        <ConnectionMap
          x={x}
          cloud={busy || (connection && !connection.confirmed) ? 'pending' : connection ? 'connected' : 'off'}
          numbers={numbers}
          size="large"
        />
      </div>
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
          <DailyNumbersSwitch token={connection.token} />
          <Button icon={<CloudOff20Regular />} disabled={busy} onClick={() => void onSignOut()}>
            Sign out of xomoni.com
          </Button>
        </div>
      ) : connection === null ? (
        <div className={styles.form}>
          {waiting ? (
            <>
              <Body1 as="p" block className={styles.text} role="status">
                Finish on xomoni.com: sign in there, in the tab that opened. Xomoni here signs in with you.
              </Body1>
              <div className={styles.actions}>
                <Button variant="primary" icon={<Open20Regular />} onClick={() => void connectOnWebsite()}>
                  Open xomoni.com again
                </Button>
                <Button variant="ghost" icon={<Dismiss20Regular />} onClick={() => void cancelWebConnect()}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <Body1 as="p" block className={styles.text}>
                Sign in once on xomoni.com: the website and Xomoni here stay signed in together. No code to type.
              </Body1>
              <Button
                variant="primary"
                icon={<Link20Regular />}
                className={styles.action}
                onClick={() => void connectOnWebsite()}
              >
                Sign in to xomoni.com
              </Button>
            </>
          )}
          <Disclosure label="Use a one-time code instead" summary="For a code from xomoni.com’s dashboard.">
            <div className={styles.form}>
              <Body1 as="p" block className={styles.text}>
                Sign in on xomoni.com and get a one-time code, then type it here.{' '}
                <Link
                  href={websiteLink('/dashboard')}
                  target="_blank"
                  rel="noreferrer"
                  inline
                  className={styles.external}
                >
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
                  <Input
                    className={styles.input}
                    value={name}
                    maxLength={80}
                    onChange={(_, data) => setName(data.value)}
                  />
                </Field>
              </div>
              <Button
                variant="secondary"
                icon={<Link20Regular />}
                className={styles.action}
                disabled={busy || code.replace(/[\s-]/g, '').length !== 10}
                onClick={() => void onConnect()}
              >
                Connect
              </Button>
            </div>
          </Disclosure>
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

/**
 * *Show my numbers on xomoni.com* (#250, ADR-0026): off until the person turns it on, here or on the website. Only
 * counts per day travel; turning it off deletes every day already sent.
 */
function DailyNumbersSwitch({ token }: { token: string }) {
  const styles = useStyles();
  const shown = useNumbersShown();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onChange = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const stored = await chooseStats(token, on);
      toast(
        stored
          ? 'Your daily numbers are shown on xomoni.com: counts only, never your posts'
          : 'Your daily numbers were removed from xomoni.com',
        stored ? 'good' : 'neutral',
      );
    } catch (err) {
      setError(err instanceof CloudError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.numbers}>
      <Switch
        label="Show my numbers on xomoni.com"
        checked={shown === true}
        disabled={busy || shown === undefined}
        onChange={(_, data) => void onChange(data.checked)}
      />
      <Caption1 as="p" block className={styles.text}>
        Counts per day only, on any device: followers, posts, what your posts received, and what Xomoni removed. Never
        your posts, replies, likes or anyone’s name. Turning it off deletes them from xomoni.com.
      </Caption1>
      {error && (
        <p role="alert" className={styles.error} data-tone="critical">
          <ErrorCircle16Regular className={styles.errorIcon} />
          {error}
        </p>
      )}
    </div>
  );
}
