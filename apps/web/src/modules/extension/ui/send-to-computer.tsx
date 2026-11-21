'use client';
// *Send to my computer* (ADR-0027, #243) on Fluent UI (ADR-0019): Xomoni runs only on a computer, so on a phone the
// site sends a link there through the phone's share sheet, else the clipboard, else an email the person writes to
// themselves (`sendWays`). The link goes as it is given: nothing reaches a server, nothing is counted or stored. The
// browser's abilities are read only after hydration, so the server's page and the first render in the browser agree.
import { Button, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { Send20Regular } from '@fluentui/react-icons';
import { useState, useSyncExternalStore } from 'react';
import { ButtonLink, TextLink } from '@/shared/ui/links';
import {
  SEND_RESULT_TEXT,
  type SendAbilities,
  type SendResult,
  type SendWay,
  firstSendWay,
  mailtoHref,
  sendWays,
  shareData,
} from '../domain/send-to-computer';

const useStyles = makeStyles({
  send: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start' },
  center: { alignItems: 'center', textAlign: 'center' },
  // The size of the site's large calls to action (`ButtonLink` with `size="large"`), so it sits beside them evenly.
  large: {
    minHeight: '44px',
    paddingLeft: tokens.spacingHorizontalXL,
    paddingRight: tokens.spacingHorizontalXL,
    borderRadius: tokens.borderRadiusLarge,
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
  },
  status: {
    maxWidth: '400px',
    margin: 0,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
  },
  // Under the button on a page: always there, so screen readers hear what is added; room only once it says something.
  below: { ':not(:empty)': { marginTop: tokens.spacingVerticalS } },
});

/** What a page's `navigator` may lack: some browsers have no share sheet, and an insecure page has no clipboard. */
interface SendNavigator {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText?: (text: string) => Promise<void> };
}

/** What this browser can do with `url`: a share sheet that takes it, and a clipboard to copy it to. */
function abilitiesFor(url: string): SendAbilities {
  const nav: SendNavigator = navigator;
  return {
    share: typeof nav.share === 'function' && (typeof nav.canShare !== 'function' || nav.canShare({ url })),
    copy: typeof nav.clipboard?.writeText === 'function',
  };
}

/** Whether the share sheet was closed by the person (`AbortError`), rather than refused by the browser. */
function closedByPerson(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

/**
 * One way, tried: what it did, `closed` when the person closed the share sheet, or `failed` when the browser refused
 * (the share sheet or the clipboard not allowed here, or the page lost focus).
 */
async function attempt(way: SendWay, url: string): Promise<SendResult | 'closed' | 'failed'> {
  const nav: SendNavigator = navigator;
  try {
    switch (way) {
      case 'share':
        await nav.share?.(shareData(url));
        return 'shared';
      case 'copy':
        await nav.clipboard?.writeText?.(url);
        return 'copied';
      case 'email':
        return 'email';
    }
  } catch (error) {
    return closedByPerson(error) ? 'closed' : 'failed';
  }
}

const noSubscription = () => () => undefined;

/** A page's way to send one link to the person's computer, from `useSendToComputer`. */
export interface ComputerSender {
  /** The way offered (`firstSendWay`): `email` on the server and while hydrating, this browser's own after. */
  way: SendWay;
  /** What happened the last time, or null before the first try and after `reset`. */
  result: SendResult | null;
  /** The email to oneself with the link in it (`mailtoHref`). */
  mailto: string;
  /** Tries each way in turn until one works; closing the share sheet stops there, with nothing to say. */
  send: () => Promise<void>;
  /** Forgets the last result, as when a dialog closes. */
  reset: () => void;
}

/**
 * Sends `url`, exactly as given, to the person's computer: the share sheet, else the clipboard, else the email
 * (`sendWays`). A way that fails hands over to the next one; the share sheet closed by the person ends it.
 */
export function useSendToComputer(url: string): ComputerSender {
  const way = useSyncExternalStore<SendWay>(
    noSubscription,
    () => firstSendWay(abilitiesFor(url)),
    () => 'email',
  );
  const [result, setResult] = useState<SendResult | null>(null);

  async function send() {
    setResult(null);
    for (const next of sendWays(abilitiesFor(url))) {
      const outcome = await attempt(next, url);
      if (outcome === 'closed') return;
      if (outcome !== 'failed') {
        setResult(outcome);
        return;
      }
    }
  }

  return { way, result, mailto: mailtoHref(url), send, reset: () => setResult(null) };
}

/**
 * *Send to my computer*, the primary action: a button for the share sheet or the clipboard, or a `mailto:` link where
 * neither is there (and on the server, so it works before the page's script). `size="large"` matches the site's large
 * calls to action.
 */
export function SendToComputerButton({
  sender,
  size = 'medium',
}: {
  sender: ComputerSender;
  size?: 'medium' | 'large';
}) {
  const s = useStyles();
  if (sender.way === 'email')
    return (
      <ButtonLink href={sender.mailto} appearance="primary" size={size} icon={<Send20Regular />}>
        Send to my computer
      </ButtonLink>
    );
  return (
    <Button
      appearance="primary"
      size={size}
      icon={<Send20Regular />}
      className={size === 'large' ? s.large : undefined}
      onClick={() => void sender.send()}
    >
      Send to my computer
    </Button>
  );
}

/**
 * What happened, in a polite live region: sent, copied, or, when neither worked, that the email is left, with its
 * link. Empty before.
 */
export function SendToComputerStatus({ sender, className }: { sender: ComputerSender; className?: string }) {
  const s = useStyles();
  return (
    <p role="status" className={mergeClasses(s.status, className)}>
      {sender.result && SEND_RESULT_TEXT[sender.result]}
      {sender.result === 'email' && (
        <>
          {' '}
          <TextLink href={sender.mailto}>Email it to yourself</TextLink>
        </>
      )}
    </p>
  );
}

/**
 * *Send to my computer* for a page: the button with what happened under it, for `url` (the install guide, from the
 * home page and /install on a phone). `align="center"` for a centered column such as the home page's hero.
 */
export function SendToComputer({
  url,
  size = 'medium',
  align = 'start',
  className,
}: {
  url: string;
  size?: 'medium' | 'large';
  align?: 'start' | 'center';
  className?: string;
}) {
  const s = useStyles();
  const sender = useSendToComputer(url);
  return (
    <div className={mergeClasses(s.send, align === 'center' && s.center, className)}>
      <SendToComputerButton sender={sender} size={size} />
      <SendToComputerStatus sender={sender} className={s.below} />
    </div>
  );
}
