'use client';

import { Button, MessageBar, MessageBarBody, Spinner, makeStyles, tokens } from '@fluentui/react-components';
import { ArrowEnter20Regular, CheckmarkCircle20Filled, Link20Regular, PersonAdd20Regular } from '@fluentui/react-icons';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { rememberExtensionId, useExtensionLink } from '@/modules/extension/ui/extension-session-sync';
import { type ConnectServices, createConnectServices } from '../client/connect';
import {
  type ConnectOutcome,
  type ConnectRequest,
  failureMessage,
  parseConnectFragment,
  recallRequest,
  rememberRequest,
} from '../domain/connect';
import { PairingLink } from './pairing-link';

/** Signs out (a POST, as `/auth/signout` requires) and comes back here through sign-in, with the request kept. */
const SIGN_OUT_AND_BACK = `/auth/signout?next=${encodeURIComponent('/login?next=/connect')}`;

/** Where a request from the extension is kept while the person signs in or signs up (another tab, for an email link). */
export const CONNECT_STORAGE_KEY = 'xomoni:connect-request';

const useStyles = makeStyles({
  stack: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalL },
  text: { margin: 0, color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase300 },
  account: {
    display: 'flex',
    flexDirection: 'column',
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  email: {
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  done: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    margin: 0,
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  check: { flexShrink: 0, color: tokens.colorPaletteGreenForeground1 },
  small: { margin: 0, color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  inlineButton: { minWidth: 0, padding: 0, verticalAlign: 'baseline', fontSize: tokens.fontSizeBase200 },
});

/** Reads the browser's storage, which can be missing or refused (private windows, blocked site data). */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Keeps the request from the URL's fragment in the browser, so it survives sign-in, and clears it from the address bar
 * (#228). Does nothing without one.
 */
export function keepRequestFromUrl(now = Date.now()): void {
  const fromUrl = parseConnectFragment(window.location.hash);
  if (!fromUrl) return;
  // The site finds this extension again later, to keep the two signed in together (#232, ADR-0025).
  rememberExtensionId(fromUrl.extensionId);
  try {
    storage()?.setItem(CONNECT_STORAGE_KEY, rememberRequest(fromUrl, now));
  } catch {
    // Without storage, the request lives as long as this page.
  }
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}

let lastRequest: ConnectRequest | null = null;

/**
 * The request this page was opened with: in the URL's fragment, or kept earlier within 15 minutes; null when there is
 * none. The same object while it doesn't change, as `useSyncExternalStore` needs.
 */
export function currentConnectRequest(now = Date.now()): ConnectRequest | null {
  let next = parseConnectFragment(window.location.hash);
  if (!next) {
    try {
      next = recallRequest(storage()?.getItem(CONNECT_STORAGE_KEY) ?? null, now);
    } catch {
      next = null;
    }
  }
  if (next && lastRequest?.extensionId === next.extensionId && lastRequest.nonce === next.nonce) return lastRequest;
  lastRequest = next;
  return next;
}

/** Forgets the kept request once it was used. */
function forgetConnectRequest() {
  try {
    storage()?.removeItem(CONNECT_STORAGE_KEY);
  } catch {
    // Nothing kept.
  }
}

/** The request lives in the URL and the browser's storage, which this page alone changes: nothing to subscribe to. */
const noSubscription = () => () => undefined;

type Progress =
  | { step: 'idle' }
  | { step: 'connecting' }
  | { step: 'connected'; account: string }
  | { step: 'failed'; request: ConnectRequest; outcome: Extract<ConnectOutcome, { ok: false }> };

/**
 * `/connect` (#228, ADR-0024): finishes the extension's *Sign in*, so one sign-in covers xomoni.com and the extension
 * in this browser (#232, ADR-0025).
 * - No request: says to start from Xomoni, or use a code from the dashboard.
 * - Signed out: sign in or create an account; the request is kept meanwhile.
 * - Signed in: names the account and signs Xomoni in at once: a one-time code is made and handed to the extension,
 *   which trades it. A failure says why and offers *Try again*. Nothing here starts or changes work on X (ADR-0006).
 */
export function ConnectPanel({
  viewerEmail,
  services,
}: {
  /** The signed-in person's email, or null when signed out. */
  viewerEmail: string | null;
  /** Injected in tests; the browser composition root otherwise. */
  services?: ConnectServices;
}) {
  const s = useStyles();
  const live = useMemo(() => services ?? createConnectServices(), [services]);
  // Undefined while rendering on the server, where there is no URL fragment or storage.
  const request = useSyncExternalStore(
    noSubscription,
    () => currentConnectRequest(),
    () => undefined,
  );
  const [progress, setProgress] = useState<Progress>({ step: 'idle' });
  const started = useRef(false);

  useEffect(() => keepRequestFromUrl(), []);

  const connect = useCallback(
    async (asked: ConnectRequest) => {
      setProgress({ step: 'connecting' });
      const outcome = await live.connect(asked);
      if (outcome.ok) {
        forgetConnectRequest();
        setProgress({ step: 'connected', account: outcome.account });
      } else {
        if (outcome.reason === 'not_asked' || outcome.reason === 'expired') forgetConnectRequest();
        setProgress({ step: 'failed', request: asked, outcome });
      }
    },
    [live],
  );

  // Signed in with a request: the person signed in for this, so Xomoni signs in with them at once (#232).
  useEffect(() => {
    if (started.current || !viewerEmail || !request) return;
    started.current = true;
    void connect(request);
  }, [viewerEmail, request, connect]);

  if (request === undefined) return <Spinner size="small" label="Reading the request from Xomoni…" />;
  // A request the extension refused is forgotten, but its message stays on screen.
  const shown = request ?? (progress.step === 'failed' ? progress.request : null);

  if (progress.step === 'connected') return <Connected account={progress.account} />;

  if (!shown)
    return (
      <div className={s.stack}>
        <p className={s.text}>
          Open Xomoni in Chrome and press <strong>Sign in to xomoni.com</strong>: this page opens with everything it
          needs. Or connect with a one-time code from your dashboard.
        </p>
        <div className={s.actions}>
          <Button as="a" href="/dashboard" appearance="primary">
            Go to the dashboard
          </Button>
          <Button as="a" href="/install">
            Install Xomoni
          </Button>
        </div>
      </div>
    );

  if (!viewerEmail)
    return (
      <div className={s.stack}>
        <p className={s.text}>
          Xomoni asked you to sign in. Sign in, or create an account, and Xomoni in this browser signs in with you.
        </p>
        <div className={s.actions}>
          <Button as="a" href="/login?next=/connect" appearance="primary" icon={<ArrowEnter20Regular />}>
            Sign in
          </Button>
          <Button as="a" href="/signup" icon={<PersonAdd20Regular />}>
            Create an account
          </Button>
        </div>
        <p className={s.small}>The request waits for 15 minutes.</p>
      </div>
    );

  const failed = progress.step === 'failed';
  return (
    <div className={s.stack}>
      <PairingLink state="waiting" />
      <div className={s.account}>
        Signing in Xomoni in this browser as
        <span className={s.email}>{viewerEmail}</span>
      </div>
      <p className={s.text}>
        One sign-in for xomoni.com and Xomoni here. Only the status of Xomoni’s jobs is sent, and your daily numbers if
        you turn them on: titles, states and counts. Never what you posted or liked. Nothing here can start or change
        work on X.
      </p>
      <div className={s.actions}>
        {failed ? (
          <Button appearance="primary" icon={<Link20Regular />} onClick={() => void connect(shown)}>
            Try again
          </Button>
        ) : (
          <Spinner size="extra-tiny" label="Signing in…" />
        )}
      </div>
      <form method="post" action={SIGN_OUT_AND_BACK} className={s.small}>
        Not your account?{' '}
        <Button type="submit" appearance="transparent" size="small" className={s.inlineButton}>
          Sign out and use another
        </Button>
        ; the request waits for 15 minutes.
      </form>
      {progress.step === 'failed' && (
        <div role="alert">
          <MessageBar intent="error">
            <MessageBarBody>{progress.outcome.message ?? failureMessage(progress.outcome.reason)}</MessageBarBody>
          </MessageBar>
        </div>
      )}
    </div>
  );
}

/** Connected: says to which account, and leads to the dashboard. */
function Connected({ account }: { account: string }) {
  const s = useStyles();
  return (
    <div className={s.stack} role="status">
      <PairingLink state="connected" />
      <p className={s.done}>
        <CheckmarkCircle20Filled className={s.check} aria-hidden />
        Xomoni in this browser is signed in{account ? ` as ${account}` : ''}.
      </p>
      <p className={s.text}>
        Signing out here or in Xomoni signs out both. Your jobs show on the dashboard as they run. You can close this
        tab.
      </p>
      <div className={s.actions}>
        <Button as="a" href="/dashboard" appearance="primary">
          Open the dashboard
        </Button>
      </div>
    </div>
  );
}

/**
 * On the dashboard: when Xomoni asked to connect this browser and the person went through sign-up (which doesn't come
 * back to `/connect`), a notice leads back there to finish. Shows nothing otherwise.
 */
export function PendingConnectNotice({ now = Date.now }: { now?: () => number }) {
  // Xomoni here already signed in with the person (#232): nothing left to finish.
  const link = useExtensionLink();
  const pending = useSyncExternalStore(
    noSubscription,
    () => {
      try {
        return recallRequest(storage()?.getItem(CONNECT_STORAGE_KEY) ?? null, now()) !== null;
      } catch {
        return false;
      }
    },
    () => false,
  );
  if (!pending || link.status === 'signed-in') return null;
  return (
    <div role="status">
      <MessageBar intent="info">
        <MessageBarBody>
          Xomoni asked to connect this browser. <a href="/connect">Finish connecting</a>: one click.
        </MessageBarBody>
      </MessageBar>
    </div>
  );
}
