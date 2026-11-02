import { CloudOff, ExternalLink, Link2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CloudError } from '../../cloud/client';
import { PAIRING_PAGE } from '../../cloud/config';
import { type CloudConnection, getConnection, watchConnection } from '../../cloud/connection';
import { connect, disconnect } from '../../cloud/sync';
import { errorMessage, fmtDateTime } from '../format';
import { toast } from '../hooks';
import { Button, Card, Field } from './ui';

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

/** The stored connection, kept current as it changes; undefined while loading. */
function useConnection(): CloudConnection | null | undefined {
  const [connection, setConnection] = useState<CloudConnection | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void getConnection().then((c) => {
        if (alive) setConnection(c);
      });
    load();
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
 * status shows on the website; or shows the connection and disconnects it. It says what is sent: status only.
 */
export function CloudCard() {
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
      toast('Connected to xomoni.com', 'good');
    } catch (err) {
      setError(err instanceof CloudError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    setBusy(true);
    try {
      await disconnect();
      toast('Disconnected from xomoni.com');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="xomoni.com"
      subtitle="Follow your jobs from any device. Only their status is sent: titles, states and counts, never what you posted or liked."
    >
      {connection ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-2">
            Connected as <strong className="font-medium text-ink">{connection.deviceName}</strong> since{' '}
            {fmtDateTime(connection.connectedAt)}.
          </p>
          <Button icon={<CloudOff size={14} />} disabled={busy} onClick={() => void onDisconnect()}>
            Disconnect
          </Button>
        </div>
      ) : connection === null ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            Sign in on xomoni.com and get a one-time code, then type it here.{' '}
            <a
              href={PAIRING_PAGE}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent"
            >
              Get a code <ExternalLink size={12} />
            </a>
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Code">
              <input
                className="field font-mono uppercase"
                value={code}
                placeholder="XXXXX-XXXXX"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <Field label="This browser’s name">
              <input className="field" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Button
            variant="primary"
            icon={<Link2 size={14} />}
            disabled={busy || code.replace(/[\s-]/g, '').length !== 10}
            onClick={() => void onConnect()}
          >
            Connect
          </Button>
          {error && (
            <p role="alert" className="text-xs text-critical">
              {error}
            </p>
          )}
        </div>
      ) : null}
    </Card>
  );
}
