// The "worker" is an x.com tab in its own small window, signed in with the
// user's own session. The dashboard drives it one command at a time.
import type { ActorCommand, PageInfo } from '../shared/messages';
import { NotReady, PageError, type Reply, WorkerGone, type XTab } from './ports';
import { sleep } from './timers';

// Session storage is cleared when the browser restarts, which is also when
// Chrome starts reusing tab ids — so a stale id never points at another tab.
const TAB_KEY = 'workerTab';

async function storedTabId(): Promise<number | null> {
  const stored = await chrome.storage.session.get(TAB_KEY);
  return typeof stored[TAB_KEY] === 'number' ? stored[TAB_KEY] : null;
}

/**
 * The worker window's size: X keeps its desktop layout down to 500 px wide (below that its menus change), and
 * 760 px shows a post with its actions.
 */
export const WORKER_SIZE = { width: 500, height: 760 } as const;

/** The part of a screen windows may use, as `window.screen` reports it in Chrome (`availLeft`/`availTop` included). */
export interface ScreenArea {
  availLeft?: number;
  availTop?: number;
  availWidth: number;
  availHeight: number;
}

/**
 * Where the worker window opens: `WORKER_SIZE`, in the bottom-right corner of the screen the dashboard is on, or
 * just the size when the screen isn't known.
 */
export function workerBounds(area = globalThis.screen as ScreenArea | undefined) {
  if (!area?.availWidth || !area.availHeight) return { ...WORKER_SIZE };
  const width = Math.min(WORKER_SIZE.width, area.availWidth);
  const height = Math.min(WORKER_SIZE.height, area.availHeight);
  return {
    width,
    height,
    left: Math.round((area.availLeft ?? 0) + area.availWidth - width),
    top: Math.round((area.availTop ?? 0) + area.availHeight - height),
  };
}

/**
 * Handle to the worker: an x.com tab in its own small popup window, driven one command at a time. Its tab id is
 * kept in `chrome.storage.session` under `workerTab`, where the service worker reads it too.
 */
export class WorkerTab implements XTab {
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

  /**
   * Opens the worker window in front, or returns the worker tab that is already open. In front, because a
   * window that opens behind a maximized one is fully covered, and macOS keeps it hidden (Chrome pauses its
   * page) until it has been on screen once, even after it is moved into view (#120). Small and docked to a
   * corner, as a popup without tabs, so it stays out of the person's way and their own tabs never land in it
   * (#138).
   */
  async open(url = 'https://x.com/home'): Promise<number> {
    const existing = await this.current();
    if (existing != null) return existing;
    const win = await chrome.windows.create({ url, focused: true, type: 'popup', ...workerBounds() });
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
      reply = await chrome.tabs.sendMessage(id, { type: 'actor', command }, { frameId: 0 });
    } catch (err) {
      if ((await this.current()) == null) throw new WorkerGone();
      throw new NotReady(notAnswered(err));
    }
    if (reply && typeof reply === 'object' && 'error' in reply) throw new PageError(String(reply.error));
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

// The errors are part of the port; re-exported for code that imports them from here.
/**
 * Chrome's error for a message no page answered, in words for the Activity log: Chrome's own text names its
 * internals (ports, the back/forward cache), which tell the person nothing.
 */
export function notAnswered(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return /back\/forward cache|message channel (?:is )?closed|message port closed|page was unloaded/i.test(raw)
    ? 'The X page changed while Xomoni was reading it'
    : 'The X page didn’t answer Xomoni';
}

export { NotReady, PageError, WorkerGone };

/** The worker handle shared by the engine (through `platform.ts`) and the dashboard UI. */
export const workerTab = new WorkerTab();
