// Everything xomoni.com may ask the extension, in one place for the service worker (ADR-0024, ADR-0025, ADR-0027). The
// manifest lets only https://xomoni.com send; the sender is checked again here, and the message must be exactly one of
// the shapes in `@xomoni/bridge`. Each asks one thing: how the extension stands, a pairing it asked for, a sign-in, a
// sign-out, to pause, cancel or resume a job, to open a page of Xomoni, to read its Library, health, Watch or settings
// (ADR-0028), or to change a few settings within Xomoni's safety rules (ADR-0029). None sends X content anywhere but
// that page, and none starts or approves work on X: a resume only opens Xomoni's own confirmation (ADR-0004,
// ADR-0027).
import { HELLO, JOB, OPEN, PAIR, READ, SETTINGS, SIGN_IN, SIGN_OUT, parseWebsiteMessage } from '@xomoni/bridge';
import { type ActionPorts, answerJob, answerOpen } from './website-actions';
import { answerRead } from './website-reads';
import { answerSettings } from './website-settings';
import { connectFromWebsite, fromWebsite } from './web-connect';
import { extensionState, signInFromWebsite, signOutFromWebsite } from './web-session';

/** The sender of an external message, as Chrome describes it. */
export interface WebsiteSender {
  origin?: string;
  url?: string;
  frameId?: number;
}

/** Messages that change the connection run one after another, so two xomoni.com tabs can't interleave them. */
let queue: Promise<unknown> = Promise.resolve();

function inTurn<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export type { ActionPorts } from './website-actions';

/**
 * The answer to a message from a page, or null when the page isn't xomoni.com's top frame, which gets no answer at
 * all. A message of any other shape is answered `invalid`. `ports` opens Xomoni's pages for the actions.
 */
export function answerWebsite(raw: unknown, sender: WebsiteSender, ports: ActionPorts): Promise<unknown> | null {
  if (!fromWebsite(sender)) return null;
  const message = parseWebsiteMessage(raw);
  if (!message) return Promise.resolve({ ok: false, reason: 'invalid' });
  switch (message.type) {
    case HELLO:
      return extensionState().then((state) => ({ ok: true, state }));
    case PAIR:
      return inTurn(() => connectFromWebsite(message));
    case SIGN_IN:
      return inTurn(() => signInFromWebsite(message));
    case SIGN_OUT:
      return inTurn(() => signOutFromWebsite());
    case JOB:
      return inTurn(() => answerJob(message, ports));
    case OPEN:
      return inTurn(() => answerOpen(message, ports));
    case READ:
      // A read changes nothing, so it needn't wait its turn.
      return answerRead(message);
    case SETTINGS:
      return inTurn(() => answerSettings(message));
  }
}
