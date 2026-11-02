import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Timers from '../src/engine/timers';
import { NotReady, PageError, WorkerGone, WorkerTab, workerTab } from '../src/engine/worker-tab';
import { WORKER_TAB, stubChrome } from './support/chrome';
import { page } from './support/engine';

// The real sleep runs on a Web Worker, which tests don't have; here it moves the fake clock forward instead.
vi.mock('../src/engine/timers', async (importOriginal) => {
  const actual = await importOriginal<typeof Timers>();
  return {
    ...actual,
    sleep: async (ms: number, signal?: AbortSignal) => {
      if (signal?.aborted) throw new actual.Aborted();
      vi.setSystemTime(Date.now() + Math.max(0, ms));
    },
  };
});

const NOW = Date.parse('2026-11-02T12:00:00Z');
const TAB_ID = WORKER_TAB.id;

let chrome: ReturnType<typeof stubChrome>;
let reload: Mock<(id: number) => Promise<void>>;
let worker: WorkerTab;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  chrome = stubChrome();
  reload = vi.fn<(id: number) => Promise<void>>(() => Promise.resolve());
  Object.assign(chrome.tabs, { reload });
  worker = new WorkerTab();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Makes the stub report the worker tab as open, as `chrome.storage.session` remembers it. */
function openTab() {
  chrome.storage.session.get.mockResolvedValue({ workerTab: TAB_ID });
  chrome.tabs.get.mockResolvedValue(WORKER_TAB);
}

describe('WorkerTab.current', () => {
  it('is null when no worker tab was opened', async () => {
    expect(await worker.current()).toBeNull();
    expect(chrome.storage.session.get).toHaveBeenCalledWith('workerTab');
    expect(chrome.tabs.get).not.toHaveBeenCalled();
  });

  it('finds the tab the session remembers, and keeps it for next time', async () => {
    openTab();

    expect(await worker.current()).toBe(TAB_ID);
    expect(await worker.current()).toBe(TAB_ID);
    expect(chrome.storage.session.get).toHaveBeenCalledOnce();
    expect(chrome.tabs.get).toHaveBeenCalledWith(TAB_ID);
  });

  it('forgets a tab the person closed', async () => {
    openTab();
    expect(await worker.current()).toBe(TAB_ID);
    chrome.tabs.get.mockRejectedValue(new Error(`No tab with id: ${TAB_ID}`));
    chrome.storage.session.get.mockResolvedValue({});

    expect(await worker.current()).toBeNull();
    expect(chrome.storage.session.remove).toHaveBeenCalledWith('workerTab');
    // Nothing is kept: the next lookup reads the session again.
    expect(await worker.current()).toBeNull();
    expect(chrome.storage.session.get).toHaveBeenCalledTimes(2);
  });

  it('ignores a stored value that is not a tab id', async () => {
    chrome.storage.session.get.mockResolvedValue({ workerTab: '7' });
    expect(await worker.current()).toBeNull();
    expect(chrome.tabs.get).not.toHaveBeenCalled();
  });
});

describe('WorkerTab.open', () => {
  it('returns the worker tab that is already open', async () => {
    openTab();

    expect(await worker.open()).toBe(TAB_ID);
    expect(chrome.windows.create).not.toHaveBeenCalled();
  });

  it('opens x.com in its own unfocused window, remembers it and keeps Chrome from unloading it', async () => {
    chrome.tabs.get.mockResolvedValue(WORKER_TAB);

    expect(await worker.open()).toBe(TAB_ID);

    expect(chrome.windows.create).toHaveBeenCalledWith({
      url: 'https://x.com/home',
      focused: false,
      width: 1100,
      height: 900,
      type: 'normal',
    });
    expect(chrome.storage.session.set).toHaveBeenCalledWith({ workerTab: TAB_ID });
    expect(chrome.tabs.update).toHaveBeenCalledWith(TAB_ID, { autoDiscardable: false });
    expect(await worker.current()).toBe(TAB_ID);
  });

  it('opens the page it is given', async () => {
    chrome.tabs.get.mockResolvedValue(WORKER_TAB);
    await worker.open('https://x.com/me/likes');
    expect(chrome.windows.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://x.com/me/likes' }));
  });

  it('fails clearly when Chrome opened a window without a tab', async () => {
    chrome.windows.create.mockResolvedValue({ id: WORKER_TAB.windowId, tabs: [] });

    await expect(worker.open()).rejects.toThrow('Could not open the X worker window');
    expect(chrome.storage.session.set).not.toHaveBeenCalled();
  });
});

describe('WorkerTab.keepLoaded and discarded (PLAYBOOK F5)', () => {
  it('does nothing without a worker tab', async () => {
    await worker.keepLoaded();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(await worker.discarded()).toBe(false);
  });

  it('ignores Chrome refusing to keep the tab loaded', async () => {
    openTab();
    chrome.tabs.update.mockRejectedValue(new Error('Tabs cannot be edited right now'));

    await expect(worker.keepLoaded()).resolves.toBeUndefined();
  });

  it('tells whether Chrome unloaded the tab to save memory', async () => {
    openTab();
    expect(await worker.discarded()).toBe(false);

    const unloaded = { ...WORKER_TAB, discarded: true };
    chrome.tabs.get.mockResolvedValue(unloaded);
    expect(await worker.discarded()).toBe(true);
  });

  it('says not unloaded when the tab disappears while checking', async () => {
    openTab();
    chrome.tabs.get.mockResolvedValueOnce(WORKER_TAB).mockRejectedValueOnce(new Error('No tab'));
    expect(await worker.discarded()).toBe(false);
  });
});

describe('WorkerTab.focus', () => {
  it('does nothing without a worker tab', async () => {
    await worker.focus();
    expect(chrome.windows.update).not.toHaveBeenCalled();
  });

  it('brings the worker window to the front', async () => {
    openTab();

    await worker.focus();

    expect(chrome.tabs.update).toHaveBeenCalledWith(TAB_ID, { active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(WORKER_TAB.windowId, { focused: true });
  });

  it('restores a minimized worker window', async () => {
    openTab();
    chrome.windows.get.mockResolvedValue({ id: WORKER_TAB.windowId, state: 'minimized' });

    await worker.focus();

    expect(chrome.windows.update).toHaveBeenCalledWith(WORKER_TAB.windowId, { focused: true, state: 'normal' });
  });
});

describe('WorkerTab.send', () => {
  it('throws WorkerGone without a worker tab, sending nothing', async () => {
    await expect(worker.send({ cmd: 'ping' })).rejects.toBeInstanceOf(WorkerGone);
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('sends one actor command to the content script and returns its reply', async () => {
    openTab();
    chrome.tabs.sendMessage.mockResolvedValue({ outcome: 'done', http: 200 });

    expect(await worker.send({ cmd: 'delete', id: '123' })).toEqual({ outcome: 'done', http: 200 });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(TAB_ID, {
      type: 'actor',
      command: { cmd: 'delete', id: '123' },
    });
  });

  it('throws NotReady when no content script answers in an open tab', async () => {
    openTab();

    const error = await worker.send({ cmd: 'ping' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotReady);
    expect((error as NotReady).message).toBe('Could not establish connection');
  });

  it('keeps a failure that is not an Error as the NotReady message', async () => {
    openTab();
    chrome.tabs.sendMessage.mockRejectedValue('port closed');

    await expect(worker.send({ cmd: 'ping' })).rejects.toThrow(new NotReady('port closed'));
  });

  it('throws WorkerGone when the tab was closed while the command was on its way', async () => {
    chrome.storage.session.get.mockResolvedValue({ workerTab: TAB_ID });
    chrome.tabs.get.mockResolvedValueOnce(WORKER_TAB).mockRejectedValue(new Error('No tab'));

    await expect(worker.send({ cmd: 'scroll' })).rejects.toBeInstanceOf(WorkerGone);
  });

  it('throws PageError when the command reports an error', async () => {
    openTab();
    chrome.tabs.sendMessage.mockResolvedValue({ error: 'Could not find the post menu' });

    await expect(worker.send({ cmd: 'unlike', id: '9' })).rejects.toThrow(
      new PageError('Could not find the post menu'),
    );
  });
});

describe('WorkerTab.ping', () => {
  it('returns the page’s state', async () => {
    openTab();
    chrome.tabs.sendMessage.mockResolvedValue(page());
    expect(await worker.ping()).toEqual(page());
  });

  it('is null while no content script answers or the page reports an error', async () => {
    openTab();
    expect(await worker.ping()).toBeNull();
    chrome.tabs.sendMessage.mockResolvedValue({ error: 'boom' });
    expect(await worker.ping()).toBeNull();
  });

  it('throws WorkerGone when there is no worker tab', async () => {
    await expect(worker.ping()).rejects.toBeInstanceOf(WorkerGone);
  });
});

describe('WorkerTab.waitReady', () => {
  const signal = () => new AbortController().signal;

  it('returns the page at once when it answers', async () => {
    openTab();
    chrome.tabs.sendMessage.mockResolvedValue(page());

    expect(await worker.waitReady(signal())).toEqual(page());
    expect(Date.now()).toBe(NOW);
  });

  it('waits for a fresh page load when given the old page’s boot id', async () => {
    openTab();
    chrome.tabs.sendMessage
      .mockResolvedValueOnce(page({ bootId: 'old' }))
      .mockResolvedValueOnce(page({ bootId: 'old' }))
      .mockResolvedValue(page({ bootId: 'new' }));

    expect(await worker.waitReady(signal(), 'old')).toMatchObject({ bootId: 'new' });
    expect(Date.now()).toBe(NOW + 1_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads a tab Chrome unloaded at once, and only once', async () => {
    openTab();
    const unloaded = { ...WORKER_TAB, discarded: true };
    chrome.tabs.get.mockResolvedValue(unloaded);
    chrome.tabs.sendMessage
      .mockRejectedValueOnce(new Error('Could not establish connection'))
      .mockRejectedValueOnce(new Error('Could not establish connection'))
      .mockResolvedValue(page());

    expect(await worker.waitReady(signal())).toEqual(page());
    expect(reload).toHaveBeenCalledExactlyOnceWith(TAB_ID);
  });

  it('reloads a tab with no content script after 10 seconds, once', async () => {
    openTab();
    let pings = 0;
    chrome.tabs.sendMessage.mockImplementation(() => {
      pings++;
      return Date.now() >= NOW + 15_000 ? Promise.resolve(page()) : Promise.reject(new Error('No receiver'));
    });

    expect(await worker.waitReady(signal())).toEqual(page());
    expect(reload).toHaveBeenCalledExactlyOnceWith(TAB_ID);
    expect(pings).toBeGreaterThan(20);
  });

  it('throws NotReady when nothing answers in time', async () => {
    openTab();

    await expect(worker.waitReady(signal(), undefined, 5_000)).rejects.toThrow(
      new NotReady('The X worker tab did not finish loading'),
    );
    expect(Date.now()).toBe(NOW + 5_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('stops waiting when the person pauses', async () => {
    openTab();
    const controller = new AbortController();
    controller.abort();

    await expect(worker.waitReady(controller.signal)).rejects.toThrow('aborted');
  });

  it('throws WorkerGone when the tab is closed while it waits', async () => {
    await expect(worker.waitReady(signal())).rejects.toBeInstanceOf(WorkerGone);
  });
});

describe('WorkerTab.navigate', () => {
  it('opens the worker window at the page when none is open', async () => {
    chrome.windows.create.mockImplementation(() => {
      openTab();
      chrome.tabs.sendMessage.mockResolvedValue(page({ url: 'https://x.com/me/likes' }));
      return Promise.resolve({ id: WORKER_TAB.windowId, tabs: [WORKER_TAB] });
    });

    expect(await worker.navigate('https://x.com/me/likes', new AbortController().signal)).toMatchObject({
      url: 'https://x.com/me/likes',
    });
    expect(chrome.windows.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://x.com/me/likes' }));
  });

  it('loads the page in the worker tab and waits for the new page, not the old one', async () => {
    openTab();
    chrome.tabs.sendMessage
      .mockResolvedValueOnce(page({ bootId: 'old' }))
      .mockResolvedValueOnce(page({ bootId: 'old' }));
    chrome.tabs.sendMessage.mockResolvedValue(page({ bootId: 'new', url: 'https://x.com/search?q=x' }));

    const info = await worker.navigate('https://x.com/search?q=x', new AbortController().signal);

    expect(chrome.tabs.update).toHaveBeenCalledWith(TAB_ID, { url: 'https://x.com/search?q=x' });
    expect(info).toMatchObject({ bootId: 'new' });
    expect(chrome.windows.create).not.toHaveBeenCalled();
  });

  it('loads the page even when the old page did not answer', async () => {
    openTab();
    chrome.tabs.sendMessage.mockRejectedValueOnce(new Error('No receiver')).mockResolvedValue(page());

    expect(await worker.navigate('https://x.com/home', new AbortController().signal)).toEqual(page());
    expect(chrome.tabs.update).toHaveBeenCalledWith(TAB_ID, { url: 'https://x.com/home' });
  });
});

describe('worker errors and the shared handle', () => {
  it('names a closed worker window', () => {
    expect(new WorkerGone()).toBeInstanceOf(Error);
    expect(new WorkerGone().message).toBe('The X worker window was closed');
    expect(new NotReady('x')).toBeInstanceOf(Error);
    expect(new PageError('x')).toBeInstanceOf(Error);
  });

  it('shares one worker handle between the engine and the dashboard', () => {
    expect(workerTab).toBeInstanceOf(WorkerTab);
  });
});
