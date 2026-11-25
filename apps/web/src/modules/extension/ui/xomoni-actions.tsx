'use client';
// Xomoni's actions on xomoni.com (ADR-0027, #251). A page asks through `useXomoni`: when Xomoni in this browser is
// signed in to this account, the request goes to it and its answer shows in a notice; otherwise one dialog says why
// not and what to do (install it, use a computer, sign in to it). Work on X is never started from here: Xomoni stops
// jobs, opens its pages, or asks the person to resume, in Xomoni. On Fluent UI (ADR-0019).
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  Spinner,
  makeStyles,
  mergeClasses,
  tokens,
  typographyStyles,
} from '@fluentui/react-components';
import {
  ArrowDownload20Regular,
  Dismiss20Regular,
  Open16Regular,
  Pause16Regular,
  Play16Regular,
  PlugConnected20Regular,
  Prohibited16Regular,
} from '@fluentui/react-icons';
import type {
  CleanupPlan,
  JobAction,
  LibraryKind,
  ReachOrder,
  ReachRange,
  ReadAnswer,
  RepliesFilter,
  SettingsAnswer,
  SettingsChange,
  XomoniPage,
} from '@xomoni/bridge';
import { type ReactElement, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { INSTALL_URL } from '@/shared/config/site';
import { ButtonLink } from '@/shared/ui/links';
import { type XomoniActionServices, createXomoniActionServices } from '../client/xomoni-actions';
import { type XomoniPresence, answerMessage, isPhoneBrowser, jobActionsFor, xomoniPresence } from '../domain/presence';
import { useExtensionLink } from './extension-session-sync';
import { SendToComputerButton, SendToComputerStatus, useSendToComputer } from './send-to-computer';

export type { XomoniPresence };

/** Where the dashboard lists connected browsers, for connecting this one. */
const BROWSERS_PATH = '/dashboard/browsers';

const useStyles = makeStyles({
  text: { ...typographyStyles.body1, margin: 0, color: tokens.colorNeutralForeground2 },
  body: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  steps: {
    display: 'grid',
    rowGap: tokens.spacingVerticalS,
    margin: 0,
    paddingLeft: tokens.spacingHorizontalXL,
    ...typographyStyles.body1,
    color: tokens.colorNeutralForeground2,
  },
  note: { ...typographyStyles.caption1, margin: 0, color: tokens.colorNeutralForeground3 },
  checking: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
  actions: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  notice: { marginBottom: tokens.spacingVerticalL },
});

/** What a page wants from Xomoni: an action on one of its jobs, or one of its pages. */
export type XomoniWant =
  | { kind: 'job'; action: JobAction; jobId: string; deviceId: string; deviceName?: string }
  | { kind: 'open'; page: XomoniPage }
  | { kind: 'plan'; plan: CleanupPlan };

/** A read a page asks of Xomoni (ADR-0028); the device is added by `useXomoni`. */
export type XomoniReadRequest =
  | { what: 'library'; kind: LibraryKind; query: string; offset: number }
  | { what: 'health' }
  | { what: 'watch' }
  | { what: 'settings' }
  | { what: 'cleanup'; plan: CleanupPlan }
  | { what: 'replies'; filter: RepliesFilter; offset: number }
  | { what: 'incoming'; author: string; query: string; offset: number }
  | { what: 'vault' }
  | { what: 'reach'; rangeDays: ReachRange; order: ReachOrder; offset: number };

/** What `useXomoni` gives a page. */
export interface XomoniControls {
  /** Whether Xomoni can act from this page, and if not, why. */
  presence: XomoniPresence;
  /** Asks Xomoni, or opens the dialog that says why it can't. */
  request(want: XomoniWant): Promise<void>;
  /** The request in flight (`pause:<job>`, `open:<page>`), or null. */
  busy: string | null;
  /** The notice and the dialog: render once, where the page's content starts. */
  ui: ReactNode;
  /**
   * Reads one of Xomoni's places in this browser (ADR-0028): null unless Xomoni is here and signed in to this account.
   * The answer is X content: keep it in memory, never store, log or send it.
   */
  read: (request: XomoniReadRequest) => Promise<ReadAnswer | null>;
  /**
   * Asks Xomoni here to change some of its settings (ADR-0029): null unless Xomoni is here and signed in to this
   * account. Xomoni applies its own rules and answers the settings as stored.
   */
  changeSettings: (change: SettingsChange) => Promise<SettingsAnswer | null>;
}

type DialogState = { kind: 'away' } | { kind: 'elsewhere'; deviceName: string | undefined };

const noSubscription = () => () => undefined;

/** Whether this is a phone or tablet; false on the server and before hydration. */
function usePhone(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => {
      const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
      return isPhoneBrowser(nav.userAgent, nav.userAgentData?.mobile);
    },
    () => false,
  );
}

/** The key of a request, for `busy`. */
function keyOf(want: XomoniWant): string {
  return want.kind === 'job' ? `${want.action}:${want.jobId}` : want.kind === 'open' ? `open:${want.page}` : 'plan';
}

/** How long a request made while the page is still looking for Xomoni waits for the answer before the dialog shows. */
export const CHECK_WAIT_MS = 5_000;

/**
 * Xomoni's actions for a page of the signed-in account (ADR-0027). `accountDevices` are the account's own browsers:
 * Xomoni counts as here only when it reports one of them. A job's action goes to Xomoni only for a job of this browser;
 * a job in another browser says so instead. A request made while the page is still looking for Xomoni waits for it,
 * with the button busy, up to `checkWaitMs`, then goes ahead or opens the dialog, which gives the focus back to the
 * control that opened it once it closes. `services` is for tests.
 */
export function useXomoni(
  accountDevices: readonly string[],
  services: () => XomoniActionServices = createXomoniActionServices,
  checkWaitMs = CHECK_WAIT_MS,
): XomoniControls {
  const link = useExtensionLink();
  const phone = usePhone();
  const presence = xomoniPresence(link, accountDevices, phone);
  const made = useRef<XomoniActionServices | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The latest presence, for a request still waiting while the page looks for Xomoni.
  const latest = useRef(presence);
  useEffect(() => {
    latest.current = presence;
  });
  const get = () => (made.current ??= services());
  // The control that opened the dialog, which gets the focus back once it closes (WCAG 2.4.3): the dialog is opened
  // from code, with no Fluent trigger to restore the focus to.
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (dialog !== null) return;
    const control = opener.current;
    opener.current = null;
    if (control?.isConnected) control.focus();
  }, [dialog]);

  // A function, so each look reads the presence as it is now.
  const checking = () => latest.current.kind === 'checking';

  async function request(want: XomoniWant) {
    const pressed = document.activeElement;
    if (checking()) {
      setBusy(keyOf(want));
      for (let waited = 0; checking() && waited < checkWaitMs; waited += 100) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const here = latest.current;
    if (here.kind !== 'here') {
      setBusy(null);
      opener.current = pressed instanceof HTMLElement ? pressed : null;
      setDialog({ kind: 'away' });
      return;
    }
    if (want.kind === 'job' && want.deviceId.toLowerCase() !== here.deviceId.toLowerCase()) {
      setBusy(null);
      opener.current = pressed instanceof HTMLElement ? pressed : null;
      setDialog({ kind: 'elsewhere', deviceName: want.deviceName });
      return;
    }
    setBusy(keyOf(want));
    setNotice(null);
    const answer = await get().ask(
      want.kind === 'job'
        ? { kind: 'job', action: want.action, jobId: want.jobId, deviceId: here.deviceId }
        : want.kind === 'open'
          ? { kind: 'open', page: want.page, deviceId: here.deviceId }
          : { kind: 'plan', plan: want.plan, deviceId: here.deviceId },
    );
    setBusy(null);
    setNotice({ text: answerMessage(answer, want.kind === 'job' ? want.action : want.kind), ok: answer.ok });
  }

  const ui = (
    <>
      {notice && <XomoniNotice text={notice.text} ok={notice.ok} onDismiss={() => setNotice(null)} />}
      <XomoniDialog
        state={dialog}
        presence={presence}
        onClose={() => setDialog(null)}
        recheck={() => get().recheck()}
      />
    </>
  );
  async function read(request: XomoniReadRequest): Promise<ReadAnswer | null> {
    const here = latest.current;
    if (here.kind !== 'here') return null;
    return get().read({ ...request, deviceId: here.deviceId });
  }
  async function changeSettings(change: SettingsChange): Promise<SettingsAnswer | null> {
    const here = latest.current;
    if (here.kind !== 'here') return null;
    return get().settings({ deviceId: here.deviceId, change });
  }

  return { presence, request, busy, ui, read, changeSettings };
}

/**
 * Reads one of Xomoni's places for a page while Xomoni is here (ADR-0028), and again when `key` changes or `reload`
 * is called. `answer` is null until Xomoni answers, and stays null while it isn't here.
 */
export function useXomoniRead(
  xomoni: XomoniControls,
  request: XomoniReadRequest,
): { answer: ReadAnswer | null; loading: boolean; reload: () => void } {
  const [answer, setAnswer] = useState<ReadAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [round, setRound] = useState(0);
  const here = xomoni.presence.kind === 'here';
  const key = JSON.stringify(request);
  const reader = useRef(xomoni.read);
  useEffect(() => {
    reader.current = xomoni.read;
  });
  useEffect(() => {
    if (!here) return;
    let live = true;
    const ask = JSON.parse(key) as XomoniReadRequest;
    void Promise.resolve()
      .then(() => {
        if (live) setLoading(true);
        return reader.current(ask);
      })
      .then((result) => {
        if (!live) return;
        setAnswer(result);
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [here, key, round]);
  return { answer: here ? answer : null, loading, reload: () => setRound((n) => n + 1) };
}

function XomoniNotice({ text, ok, onDismiss }: { text: string; ok: boolean; onDismiss: () => void }) {
  const s = useStyles();
  return (
    <div role="status" className={s.notice}>
      <MessageBar intent={ok ? 'success' : 'warning'}>
        <MessageBarBody>{text}</MessageBarBody>
        <MessageBarActions
          containerAction={
            <Button appearance="transparent" aria-label="Dismiss" icon={<Dismiss20Regular />} onClick={onDismiss} />
          }
        />
      </MessageBar>
    </div>
  );
}

/**
 * The one dialog for when Xomoni can't act from here (ADR-0027): not installed in this browser, a phone, signed out or
 * signed in to another account, or a job that runs in another browser. It follows `presence` live, so a check that
 * finds Xomoni says so.
 */
export function XomoniDialog({
  state,
  presence,
  onClose,
  recheck,
}: {
  state: DialogState | null;
  presence: XomoniPresence;
  onClose: () => void;
  recheck: () => Promise<void>;
}) {
  const s = useStyles();
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  // On a phone, this page goes to the computer as it is, so a cleanup plan in its address goes too (#235).
  const sender = useSendToComputer(typeof window === 'undefined' ? '' : window.location.href);

  function close() {
    setChecked(false);
    sender.reset();
    onClose();
  }

  async function check() {
    setChecking(true);
    await recheck();
    setChecking(false);
    setChecked(true);
  }

  let title: string;
  let body: ReactNode;
  let actions: ReactNode = null;
  if (state?.kind === 'elsewhere') {
    title = 'This job runs in another browser';
    body = (
      <p className={s.text}>
        It runs in {state.deviceName ?? 'another browser'}. Xomoni acts only in the browser where the job runs: open
        xomoni.com there to pause, cancel or resume it.
      </p>
    );
  } else {
    switch (presence.kind) {
      case 'checking':
        title = 'Looking for Xomoni';
        body = (
          <p className={mergeClasses(s.text, s.checking)}>
            <Spinner size="extra-tiny" /> Looking for Xomoni in this browser…
          </p>
        );
        break;
      case 'here':
        title = 'Xomoni is ready';
        body = <p className={s.text}>Xomoni in this browser is signed in to your account. Try again.</p>;
        break;
      case 'not-installed':
        title = 'You haven’t installed Xomoni yet';
        body = (
          <div className={s.body}>
            <p className={s.text}>
              Xomoni’s actions run in the Xomoni extension, on this computer. Install it once, and everything on this
              page works in this browser.
            </p>
            <ol className={s.steps}>
              <li>Download Xomoni and add it to Chrome: the install page shows each step.</li>
              <li>Open Xomoni and press Connect to xomoni.com once. It links Xomoni to this account.</li>
            </ol>
            {checked && (
              <p className={s.note} role="status">
                Xomoni isn’t linked to this page yet. Open Xomoni and press Connect to xomoni.com once, then try again.
              </p>
            )}
          </div>
        );
        actions = (
          <>
            <ButtonLink href={INSTALL_URL} appearance="primary" icon={<ArrowDownload20Regular />}>
              Install Xomoni
            </ButtonLink>
            <Button disabled={checking} onClick={() => void check()}>
              I’ve installed it
            </Button>
          </>
        );
        break;
      case 'phone':
        title = 'Xomoni runs on a computer';
        body = (
          <div className={s.body}>
            <p className={s.text}>
              Xomoni works in Chrome on a computer, where it acts on X for you. On this phone you can follow everything
              it does.
            </p>
            {sender.result && <SendToComputerStatus sender={sender} className={s.note} />}
          </div>
        );
        actions = <SendToComputerButton sender={sender} />;
        break;
      case 'signed-out':
      case 'other-account':
        title = 'Sign in to Xomoni in this browser';
        body = (
          <div className={s.body}>
            <p className={s.text}>
              {presence.kind === 'signed-out'
                ? 'Xomoni is installed here but isn’t signed in to your account. Open Xomoni and choose Sign in, or connect this browser.'
                : 'Xomoni in this browser is signed in to another xomoni.com account. Sign out of Xomoni there, then sign in with this account.'}
            </p>
            {checked && (
              <p className={s.note} role="status">
                Xomoni here still isn’t signed in to this account.
              </p>
            )}
          </div>
        );
        actions = (
          <>
            <ButtonLink href={BROWSERS_PATH} appearance="primary" icon={<PlugConnected20Regular />}>
              Connect this browser
            </ButtonLink>
            <Button disabled={checking} onClick={() => void check()}>
              I’ve signed in
            </Button>
          </>
        );
        break;
    }
  }

  return (
    <Dialog open={state !== null} onOpenChange={(_, data) => !data.open && close()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>{body}</DialogContent>
          <DialogActions fluid className={s.actions}>
            {actions}
            <Button onClick={close}>Close</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

const ACTION_LABEL: Record<JobAction, string> = { pause: 'Pause', cancel: 'Cancel', resume: 'Resume' };
const ACTION_ICON: Record<JobAction, ReactElement> = {
  pause: <Pause16Regular />,
  cancel: <Prohibited16Regular />,
  resume: <Play16Regular />,
};

/**
 * A job's buttons on xomoni.com: Pause and Cancel while it runs, Resume and Cancel while it waits, none once it has
 * ended. Each asks Xomoni through `xomoni`, which shows the dialog when Xomoni can't act from here.
 */
export function XomoniJobActions({
  xomoni,
  job,
  deviceName,
}: {
  xomoni: XomoniControls;
  job: { localId: string; deviceId: string; state: string; title: string };
  deviceName?: string;
}) {
  const s = useStyles();
  const actions = jobActionsFor(job.state);
  if (actions.length === 0) return null;
  return (
    <div className={s.actions} role="group" aria-label={`Actions for ${job.title}`}>
      {actions.map((action) => {
        const busy = xomoni.busy === `${action}:${job.localId}`;
        return (
          <Button
            key={action}
            size="small"
            appearance={action === 'cancel' ? 'subtle' : 'secondary'}
            icon={busy ? <Spinner size="extra-tiny" /> : ACTION_ICON[action]}
            disabled={xomoni.busy !== null}
            onClick={() =>
              void xomoni.request({
                kind: 'job',
                action,
                jobId: job.localId,
                deviceId: job.deviceId,
                deviceName,
              })
            }
          >
            {ACTION_LABEL[action]}
          </Button>
        );
      })}
    </div>
  );
}

/**
 * *Open in Xomoni* for a place whose data and actions live in Xomoni: opens that page, or the dialog. `label` names the
 * button where a page shows two places with one, such as *Open the vault in Xomoni* beside the Library's, so that each
 * button's name says where it goes.
 */
export function OpenInXomoni({
  xomoni,
  page,
  label = 'Open in Xomoni',
}: {
  xomoni: XomoniControls;
  page: XomoniPage;
  label?: string;
}) {
  const busy = xomoni.busy === `open:${page}`;
  return (
    <Button
      appearance="primary"
      icon={busy ? <Spinner size="extra-tiny" /> : <Open16Regular />}
      disabled={xomoni.busy !== null}
      onClick={() => void xomoni.request({ kind: 'open', page })}
    >
      {label}
    </Button>
  );
}
