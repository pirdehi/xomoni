// The engine's ports (#11, ADR-0015): what the job runner needs from the platform, as interfaces. The engine's
// core (runner, context, cleanup, scan, samples, limiter) depends on these, never on `chrome.*`. The adapters are
// `worker-tab.ts` (the X tab), `../shared/notify.ts` (desktop notifications) and `presence.ts` (the person and the
// display), wired in `platform.ts`.
import type {
  ActionResult,
  ActorCommand,
  CanaryResult,
  ClearResult,
  ContentState,
  PageInfo,
  ScrollResult,
  VisibleTweet,
} from '../shared/messages';

/** The reply the content script sends for each command. */
export type Reply<C extends ActorCommand['cmd']> = C extends 'ping'
  ? PageInfo
  : C extends 'waitContent'
    ? ContentState
    : C extends 'visible'
      ? VisibleTweet[]
      : C extends 'scroll'
        ? ScrollResult
        : C extends 'canary'
          ? CanaryResult
          : C extends 'clearPage'
            ? ClearResult
            : ActionResult;

/** The worker tab was closed. The runner pauses the job; resuming opens a new worker. */
export class WorkerGone extends Error {
  constructor() {
    super('The X worker window was closed');
  }
}

/**
 * No content script answered in the worker tab, usually because the page is loading, reloading or was
 * unloaded by Chrome. The runner waits and runs the job's steps again (`JobContext.waitOut`).
 */
export class NotReady extends Error {}

/** The content script in the worker tab reported an error running a command. The runner pauses the job. */
export class PageError extends Error {}

/**
 * The x.com tab the engine drives, one command at a time. Methods throw `WorkerGone`, `NotReady` or `PageError`
 * as documented on each; the adapter is `WorkerTab` in `worker-tab.ts`.
 */
export interface XTab {
  /** The live tab's id, or null when none is open. */
  current(): Promise<number | null>;
  /** Opens the tab in a window in front (#120), or returns the one already open. */
  open(): Promise<number>;
  /** Brings the tab's window to the front, restoring it if minimized. */
  focus(): Promise<void>;
  /** Asks the browser not to discard the tab while a job runs. */
  keepLoaded(): Promise<void>;
  /** Whether the browser discarded the tab to save memory. */
  discarded(): Promise<boolean>;
  /** Resolves with the page's state once its content script answers (a new page load when `notBootId` is given). */
  waitReady(signal: AbortSignal, notBootId?: string): Promise<PageInfo>;
  /** Loads `url` in the tab and resolves when the new page answers. */
  navigate(url: string, signal: AbortSignal): Promise<PageInfo>;
  /** The page's state, or null when the content script doesn't answer. */
  ping(): Promise<PageInfo | null>;
  /** Sends one command to the content script and returns its typed reply. */
  send<C extends ActorCommand>(command: C): Promise<Reply<C['cmd']>>;
}

/** Desktop notifications; the adapter is `../shared/notify.ts`. */
export interface Notifier {
  /** Shows a notification, replacing one with the same id; `sticky` keeps it until the person acts. Never throws. */
  notify(id: string, title: string, message: string, sticky?: boolean): Promise<void>;
  /** Removes a notification if it is showing. */
  clear(id: string): void;
}

/**
 * The person at the computer and the display, so a job can keep going while the person is away; the adapter is
 * `presence.ts` (Chrome's `idle` and `power` APIs).
 */
export interface Presence {
  /** Whether keyboard and mouse have been untouched for `seconds` (at least 15) on an unlocked screen. Never throws. */
  away(seconds: number): Promise<boolean>;
  /** Keeps the display from sleeping while a job runs (`true`), or lets it sleep again (`false`). Never throws. */
  keepDisplayOn(on: boolean): void;
}

/** Everything the engine needs from the platform, handed in by a composition root. */
export interface EnginePorts {
  xTab: XTab;
  notifier: Notifier;
  presence: Presence;
}
