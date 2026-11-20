import {
  HELLO,
  JOB,
  OPEN,
  PLAN,
  READ,
  SETTINGS,
  SIGN_IN,
  SIGN_OUT,
  parseActionAnswer,
  parseExtensionState,
  parseReadAnswer,
  parseSettingsAnswer,
  parseSignInAnswer,
  parseSignOutAnswer,
} from '@xomoni/bridge';
import type { ActionChannel, ExtensionChannel } from '../application/ports';

/**
 * The part of `chrome.runtime` Chrome gives a web page when an installed extension lists the page's origin in
 * `externally_connectable`; undefined otherwise (no such extension, or another browser).
 */
export interface PageRuntime {
  sendMessage(extensionId: string, message: unknown, callback: (answer: unknown) => void): void;
  lastError?: { message?: string };
}

/** `chrome.runtime` as this page sees it, if Chrome exposes it. */
function pageRuntime(): PageRuntime | undefined {
  return (globalThis as { chrome?: { runtime?: PageRuntime } }).chrome?.runtime;
}

/** How long a hello or a sign-out waits for the extension; a sign-in waits for xomoni.com's answer too. */
export const ANSWER_TIMEOUT_MS = 5_000;
/** How long a sign-in waits: the extension trades the code with xomoni.com before it answers. */
export const SIGN_IN_TIMEOUT_MS = 30_000;
/** How long a read waits: a search runs through the whole Library. */
export const READ_TIMEOUT_MS = 15_000;

/**
 * Sends `message` and resolves with the answer, or undefined when there is none: no runtime on this page, the
 * extension isn't there (`lastError`), it threw, or `timeoutMs` passed.
 */
function send(
  runtime: PageRuntime | undefined,
  extensionId: string,
  message: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve) => {
    if (typeof runtime?.sendMessage !== 'function') {
      resolve(undefined);
      return;
    }
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    try {
      runtime.sendMessage(extensionId, message, (answer) => {
        clearTimeout(timer);
        resolve(runtime.lastError ? undefined : answer);
      });
    } catch {
      clearTimeout(timer);
      resolve(undefined);
    }
  });
}

/**
 * `ExtensionChannel` and `ActionChannel` over `chrome.runtime.sendMessage` (ADR-0025, ADR-0027). Every answer goes
 * through the strict parsers in `@xomoni/bridge`: anything unexpected is no answer (`null`) or a refusal.
 */
export function createChromeExtensionChannel(
  runtime: () => PageRuntime | undefined = pageRuntime,
  timeouts = { answer: ANSWER_TIMEOUT_MS, signIn: SIGN_IN_TIMEOUT_MS, read: READ_TIMEOUT_MS },
): ExtensionChannel & ActionChannel {
  return {
    async hello(extensionId) {
      return parseExtensionState(await send(runtime(), extensionId, { type: HELLO }, timeouts.answer));
    },
    async signIn(extensionId, message) {
      return parseSignInAnswer(await send(runtime(), extensionId, { type: SIGN_IN, ...message }, timeouts.signIn));
    },
    async signOut(extensionId) {
      return parseSignOutAnswer(await send(runtime(), extensionId, { type: SIGN_OUT }, timeouts.answer));
    },
    async job(extensionId, message) {
      return parseActionAnswer(await send(runtime(), extensionId, { type: JOB, ...message }, timeouts.answer));
    },
    async open(extensionId, message) {
      return parseActionAnswer(await send(runtime(), extensionId, { type: OPEN, ...message }, timeouts.answer));
    },
    async read(extensionId, message) {
      return parseReadAnswer(
        await send(runtime(), extensionId, { type: READ, ...message }, timeouts.read),
        message.what,
      );
    },
    async plan(extensionId, message) {
      return parseActionAnswer(await send(runtime(), extensionId, { type: PLAN, ...message }, timeouts.answer));
    },
    async settings(extensionId, message) {
      return parseSettingsAnswer(await send(runtime(), extensionId, { type: SETTINGS, ...message }, timeouts.answer));
    },
  };
}
