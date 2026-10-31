// The "worker" is a normal x.com tab in its own window, signed in with the
// user's own session. The dashboard drives it one command at a time.
import type {
  ActionResult,
  ActorCommand,
  ContentState,
  PageInfo,
  ScrollResult,
  VisibleTweet,
} from '../shared/messages';
import { sleep } from './timers';

type Reply<C extends ActorCommand['cmd']> = C extends 'ping'
  ? PageInfo
  : C extends 'waitContent'
    ? ContentState
    : C extends 'visible'
      ? VisibleTweet[]
      : C extends 'scroll'
        ? ScrollResult
        : ActionResult;

// Session storage is cleared when the browser restarts, which is also when
// Chrome starts reusing tab ids — so a stale id never points at another tab.
const TAB_KEY = 'workerTab';

async function storedTabId(): Promise<number | null> {
  const stored = await chrome.storage.session.get(TAB_KEY);
  return typeof stored[TAB_KEY] === 'number' ? stored[TAB_KEY] : null;
}

/**
 * Handle to the worker: a normal x.com tab in its own window, driven one command at a time. Its tab id is
 * kept in `chrome.storage.session` under `workerTab`, where the service worker reads it too.
 */
export class WorkerTab {
  private tabId: number | null = null;

  /** Returns the live worker tab id, or null if none is open. */
  async current(): Promise<number | null> {
    const id = this.tabId ?? (await storedTabId());
    if (id == null) return null;
    try {
      const tab = await chrome.tabs.get(id);
      this.tabId = tab.id ?? null;
      return this.tabId;
    } catch {
      this.tabId = null;
      await chrome.storage.session.remove(TAB_KEY);
      return null;
    }
  }

  /** Opens the worker window without focusing it, or returns the worker tab that is already open. */
  async open(url = 'https://x.com/home'): Promise<number> {
    const existing = await this.current();
    if (existing != null) return existing;
    const win = await chrome.windows.create({ url, focused: false, width: 1100, height: 900, type: 'normal' });
    const tabId = win?.tabs?.[0]?.id;
    if (tabId == null) throw new Error('Could not open the X worker window');
    this.tabId = tabId;
    await chrome.storage.session.set({ [TAB_KEY]: tabId });
    await this.keepLoaded();
    return tabId;
  }

  /**
   * Asks Chrome not to unload the worker tab to save memory (Memory Saver), which would cut a run short
   * (PLAYBOOK F5). Chrome may still do it under memory pressure; `waitReady` then reloads the tab.
   */
  async keepLoaded() {
    const id = await this.current();
    if (id != null) await chrome.tabs.update(id, { autoDiscardable: false }).catch(() => {});
  }

  /** Whether Chrome unloaded the worker tab to save memory. It answers nothing until it is reloaded. */
  async discarded(): Promise<boolean> {
    const id = await this.current();
    if (id == null) return false;
    const tab = await chrome.tabs.get(id).catch(() => null);
    return tab?.discarded === true;
  }

  /** Brings the worker window to the front and restores it if minimized. */
  async focus() {
    const id = await this.current();
    if (id == null) return;
    const tab = await chrome.tabs.get(id);
    const win = await chrome.windows.get(tab.windowId);
    await chrome.tabs.update(id, { active: true });
    await chrome.windows.update(tab.windowId, {
      focused: true,
      ...(win.state === 'minimized' && { state: 'normal' as const }),
    });
  }

  /**
   * Sends one command to the content script and returns its typed reply. Throws `WorkerGone` if the tab is
   * closed, `NotReady` if no content script answered, and `PageError` if the command itself reported an error.
   */
  async send<C extends ActorCommand>(command: C): Promise<Reply<C['cmd']>> {
    const id = await this.current();
    if (id == null) throw new WorkerGone();
    let reply: unknown;
    try {
      reply = await chrome.tabs.sendMessage(id, { type: 'actor', command });
    } catch (err) {
      if ((await this.current()) == null) throw new WorkerGone();
      throw new NotReady(String(err instanceof Error ? err.message : err));
    }
    if (reply && typeof reply === 'object' && 'error' in reply)
      throw new PageError(String((reply as { error: unknown }).error));
    return reply as Reply<C['cmd']>;
  }

  /** The page's state, or null if the content script does not answer. Throws only `WorkerGone`. */
  async ping(): Promise<PageInfo | null> {
    try {
      return await this.send({ cmd: 'ping' });
    } catch (err) {
      if (err instanceof WorkerGone) throw err;
      return null;
    }
  }

  /**
   * Waits until the content script answers (optionally from a fresh page load). Reloads the tab once: at once
   * if Chrome unloaded it to save memory, after 10 s if it still has no content script. Throws `NotReady` when
   * nothing answers within `timeoutMs`.
   */
  async waitReady(signal: AbortSignal, notBootId?: string, timeoutMs = 45_000): Promise<PageInfo> {
    const started = Date.now();
    let reloaded = false;
    while (Date.now() < started + timeoutMs) {
      const info = await this.ping();
      if (info && info.bootId !== notBootId) return info;
      // A tab opened before the extension was (re)loaded has no content script yet.
      if (!info && !reloaded && (Date.now() - started > 10_000 || (await this.discarded()))) {
        reloaded = true;
        const id = await this.current();
        if (id != null) await chrome.tabs.reload(id);
      }
      await sleep(500, signal);
    }
    throw new NotReady('The X worker tab did not finish loading');
  }

  /** Full navigation; X re-renders from scratch, which keeps state predictable. */
  async navigate(url: string, signal: AbortSignal): Promise<PageInfo> {
    const existing = await this.current();
    if (existing == null) {
      await this.open(url);
      return this.waitReady(signal);
    }
    const before = await this.ping();
    await chrome.tabs.update(existing, { url });
    return this.waitReady(signal, before?.bootId);
  }
}

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

/** The worker handle shared by the engine and the dashboard UI. */
export const workerTab = new WorkerTab();
